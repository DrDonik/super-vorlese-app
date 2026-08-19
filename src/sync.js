import { ROOM_TTL_MS, ROOM_REFRESH_MS, DATABASE_URL } from './sync-constants.js';

const firebaseConfig = {
  apiKey: "AIzaSyDeI6LYnu-34xlnAx7Onjwa_bI52boW8GM",
  authDomain: "super-vorlese-app.firebaseapp.com",
  databaseURL: DATABASE_URL,
  projectId: "super-vorlese-app",
  storageBucket: "super-vorlese-app.firebasestorage.app",
  messagingSenderId: "759114747696",
  appId: "1:759114747696:web:d2c1718b08bf68d83282f5"
};

const STORAGE_KEY = 'sync-rooms';

function loadSavedRooms() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveRoomForBook(bookId, roomCode, isCreator, memberId) {
  const rooms = loadSavedRooms();
  rooms[bookId] = { code: roomCode, isCreator, memberId };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms)); } catch {}
}

function removeRoomForBook(bookId) {
  const rooms = loadSavedRooms();
  delete rooms[bookId];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms)); } catch {}
}

function getSavedRoom(bookId) {
  const entry = loadSavedRooms()[bookId];
  if (!entry) return null;
  if (typeof entry === 'string') return { code: entry, isCreator: false };
  return entry;
}

function randomId() {
  return Math.random().toString(36).substring(2, 9);
}

// Whether a room has run its lease out (ADR 27). Deliberately one day stricter
// than the reaper: a room the sweep is about to delete already reads as gone
// here, so no client can renew it in the gap between the job's listing and its
// write, and the deletion needs no conditional request.
function roomIsGone(data) {
  if (!data) return true;
  if (typeof data.updatedAt !== 'number') return false;
  return Date.now() - data.updatedAt > ROOM_TTL_MS;
}

let firebasePromise = null;

async function loadFirebase() {
  if (firebasePromise) return firebasePromise;
  firebasePromise = (async () => {
    try {
      const [appMod, dbMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/database'),
      ]);
      const app = appMod.initializeApp(firebaseConfig);
      const db = dbMod.getDatabase(app);
      return { db, ...dbMod };
    } catch (err) {
      firebasePromise = null;
      throw err;
    }
  })();
  return firebasePromise;
}

export const CODE_LENGTH = 6;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// The one reading of a typed Synchronisations-Code: read aloud over a video
// call, it arrives with stray spaces and in whatever case the keyboard felt
// like. Both entry fields normalize as the user types (see code-field.js), and
// lookupRoom / joinRoom normalize again for callers that pass a raw string.
export function normalizeRoomCode(code) {
  return code.toUpperCase().replace(/\s+/g, '');
}

// Whether a typed code is whole and thus worth looking up — used to gray out
// „Verbinden" until it is (rule 5: prevent errors).
export function isCompleteRoomCode(code) {
  return normalizeRoomCode(code).length === CODE_LENGTH;
}

const activeSessions = new Map();

export function getSavedRoomCode(bookId) {
  return getSavedRoom(bookId)?.code || null;
}

// Resolves the raw firebase/database module bundle (db + functions), loading
// it on first use. Shared with the WebRTC transfer layer in transfer.js.
export function getFirebase() {
  return loadFirebase();
}

// Reads a room without joining it: used by the library "Gemeinsam lesen" flow
// to discover which book a code is for before deciding whether to fetch it.
export async function lookupRoom(code) {
  const fb = await loadFirebase();
  const normalizedCode = normalizeRoomCode(code);
  if (normalizedCode.length !== CODE_LENGTH) {
    throw new Error('Der Synchronisations-Code besteht aus 6 Zeichen.');
  }
  const r = fb.ref(fb.db, `rooms/${normalizedCode}`);
  const snapshot = await fb.get(r);
  if (!snapshot.exists()) {
    throw new Error('Diesen Synchronisations-Code gibt es nicht.');
  }
  const data = snapshot.val();
  if (roomIsGone(data)) {
    fb.remove(r).catch(() => {});
    throw new Error('Diesen Synchronisations-Code gibt es nicht.');
  }
  return { code: normalizedCode, book: data.book || null, page: data.page };
}

export function getSessionForBook(bookId) {
  return activeSessions.get(bookId) || null;
}

// Ends this device's participation in a room: purely local, touching nothing in
// the database (ADR 27). Nobody is enrolled anywhere, so there is nothing to
// remove and no way to tell whether anyone else is still reading — the room
// simply stays until its lease runs out and the reaper takes it. The partner
// keeps their session either way, which is what ADR 7 was after (issue #50).
export function closeSyncForBook(bookId) {
  const session = activeSessions.get(bookId);
  if (session) {
    session.stop();
  } else {
    removeRoomForBook(bookId);
  }
}

export class SyncSession {
  constructor(bookId) {
    this.bookId = bookId;
    this.roomCode = null;
    this.unsubscribe = null;
    this.onRemotePageChange = null;
    this.onRoomDeleted = null;
    this.isCreator = false;
    // Two identifiers, deliberately independent (ADR 26).
    //
    // memberId keys this device's pointer and its mood picks. It is persisted
    // alongside the room code and reused on reconnect for one reason only: the
    // mood ritual counts the devices taking part (issue #82), and a device that
    // restarts mid-ritual would otherwise be counted twice. Both places it
    // appears are wiped by design — the pointer by onDisconnect, the mood node
    // per ritual — so it never accumulates into a history. It is drawn fresh per
    // book, so two books mean two unrelated ids and the database never shows
    // that one device holds both.
    //
    // senderId is drawn fresh for every app run and never stored. Its only job
    // is the echo test in listen(): "was that page write my own?" A stable value
    // would answer that no better, and would leave `senderId` + `updatedAt`
    // standing in the room as "this device turned a page yesterday at 20:14",
    // readable by anyone holding the code.
    this.memberId = randomId();
    this.senderId = randomId();
    this.fb = null;
    this.pointersUnsub = null;
    this.pointerDisconnect = null;
    // The room's lease as this device last saw it, kept current by the room
    // listener so renewing it costs no extra read (see sendPage).
    this.lastUpdatedAt = null;
    this.moodUnsub = null;
  }

  async createRoom(initialPage, bookDescriptor = null) {
    this.fb = await loadFirebase();
    let code, r;
    for (let i = 0; i < 5; i++) {
      code = generateRoomCode();
      r = this.fb.ref(this.fb.db, `rooms/${code}`);
      const snapshot = await this.fb.get(r);
      if (!snapshot.exists()) break;
      if (i === 4) throw new Error('Es konnte kein Synchronisations-Code erstellt werden. Bitte erneut versuchen.');
    }
    const payload = {
      page: initialPage,
      senderId: this.senderId,
      updatedAt: this.fb.serverTimestamp(),
    };
    // The book descriptor lets a partner who joins from the library recognise
    // the book and fetch it if they don't already have it.
    if (bookDescriptor) payload.book = bookDescriptor;
    await this.fb.set(r, payload);
    this.roomCode = code;
    this.isCreator = true;
    this.lastUpdatedAt = Date.now();
    activeSessions.set(this.bookId, this);
    saveRoomForBook(this.bookId, code, true, this.memberId);
    this.listen();
    return code;
  }

  async joinRoom(code) {
    this.fb = await loadFirebase();
    const normalizedCode = normalizeRoomCode(code);
    if (normalizedCode.length !== CODE_LENGTH) {
      throw new Error('Der Synchronisations-Code besteht aus 6 Zeichen.');
    }
    const r = this.fb.ref(this.fb.db, `rooms/${normalizedCode}`);
    const snapshot = await this.fb.get(r);
    if (!snapshot.exists()) {
      throw new Error('Diesen Synchronisations-Code gibt es nicht.');
    }
    const data = snapshot.val();
    if (roomIsGone(data)) {
      this.fb.remove(r).catch(() => {});
      throw new Error('Diesen Synchronisations-Code gibt es nicht.');
    }
    // Rejoining the room this device already had saved for this book: keep the
    // id it is known by there, so a pointer or a mood pick that is still in
    // flight stays ours rather than arriving as a second participant.
    const saved = getSavedRoom(this.bookId);
    if (saved?.memberId && saved.code === normalizedCode) {
      this.memberId = saved.memberId;
    }

    this.roomCode = normalizedCode;
    this.isCreator = false;
    this.lastUpdatedAt = data.updatedAt ?? null;
    activeSessions.set(this.bookId, this);
    saveRoomForBook(this.bookId, normalizedCode, false, this.memberId);
    this.listen();
    return normalizedCode;
  }

  listen() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
    let stoppedDuringInit = false;
    const callback = (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        if (this.onRoomDeleted) {
          stoppedDuringInit = true;
          this.onRoomDeleted();
        }
        return;
      }
      // Every change carries the room's whole node, so the lease value stays
      // current here rather than costing a read of its own when it is needed.
      if (typeof data.updatedAt === 'number') this.lastUpdatedAt = data.updatedAt;
      if (data.senderId !== this.senderId && this.onRemotePageChange) {
        this.onRemotePageChange(data.page);
      }
    };
    const unsub = this.fb.onValue(r, callback, () => {
      if (this.onRoomDeleted) this.onRoomDeleted();
    });
    if (stoppedDuringInit) {
      unsub();
    } else {
      this.unsubscribe = unsub;
    }
  }

  async reconnect() {
    const saved = getSavedRoom(this.bookId);
    if (!saved) return null;
    this.fb = await loadFirebase();
    const r = this.fb.ref(this.fb.db, `rooms/${saved.code}`);
    const snapshot = await this.fb.get(r);
    if (!snapshot.exists()) {
      removeRoomForBook(this.bookId);
      return null;
    }
    const data = snapshot.val();
    if (roomIsGone(data)) {
      this.fb.remove(r).catch(() => {});
      removeRoomForBook(this.bookId);
      return null;
    }
    const currentSaved = getSavedRoom(this.bookId);
    if (!currentSaved || currentSaved.code !== saved.code || activeSessions.has(this.bookId)) {
      return null;
    }
    this.roomCode = saved.code;
    this.isCreator = saved.isCreator;
    this.lastUpdatedAt = data.updatedAt ?? null;
    // Reuse the persisted id so a device that comes back is the same
    // participant to the mood ritual's count as before (issue #82).
    if (saved.memberId) this.memberId = saved.memberId;
    activeSessions.set(this.bookId, this);
    saveRoomForBook(this.bookId, saved.code, saved.isCreator, this.memberId);
    this.listen();
    return saved.code;
  }

  detach() {
    this.stopListeningPointers();
    this.stopListeningMood();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.onRemotePageChange = null;
    this.onRoomDeleted = null;
  }

  async sendPage(page) {
    if (!this.roomCode || !this.fb) return;
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
    const payload = { page, senderId: this.senderId };
    // The room's lease, renewed at most once a month and only ever riding a
    // write that was happening anyway (ADR 27). Deliberately not on connecting
    // or reconnecting: a timestamp written when a device comes online is
    // exactly the "who was last there, and when" record this design removes.
    const renewing = this.leaseIsDue();
    if (renewing) payload.updatedAt = this.fb.serverTimestamp();
    // update (not set) so the page exchange never clobbers the room's book
    // descriptor or an in-flight WebRTC signalling handshake.
    await this.fb.update(r, payload);
    // Only once the write has landed. Recording the renewal up front would let
    // one failed write hold the lease back for another month, and the room
    // could then be reaped while the two of them are still turning pages. The
    // listener replaces this with the server's own value moments later.
    if (renewing) this.lastUpdatedAt = Date.now();
  }

  // Whether the room's lease is stale enough to be worth renewing, and still
  // young enough that renewing it means anything.
  //
  // An unknown value is never renewed: every room carries a timestamp, so not
  // knowing it means the listener has not spoken yet, and writing on a hunch
  // would put the connect-time stamp back that this whole design is about
  // avoiding. Past the TTL there is nothing left to renew either — the room
  // reads as gone to every client (roomIsGone) and belongs to the reaper, so a
  // page write that renewed it would resurrect a room others have written off
  // and race the sweep that is about to remove it.
  leaseIsDue() {
    if (typeof this.lastUpdatedAt !== 'number') return false;
    const age = Date.now() - this.lastUpdatedAt;
    return age > ROOM_REFRESH_MS && age <= ROOM_TTL_MS;
  }

  // --- Pointer ("point at the page") presence ----------------------------
  // A pointer lives at rooms/{code}/pointers/{memberId} = { x, y } where x and
  // y are fractions (0..1) of the reader stage. It exists only while a finger
  // is held down, and unlike the room itself it IS tied to the live connection:
  // an onDisconnect handler removes it if the device drops mid-gesture.

  async sendPointer(x, y) {
    if (!this.roomCode || !this.fb) return;
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}/pointers/${this.memberId}`);
    if (!this.pointerDisconnect) {
      this.pointerDisconnect = this.fb.onDisconnect(r);
      this.pointerDisconnect.remove().catch(() => {});
    }
    await this.fb.set(r, { x, y });
  }

  async clearPointer() {
    if (this.pointerDisconnect) {
      this.pointerDisconnect.cancel().catch(() => {});
      this.pointerDisconnect = null;
    }
    if (!this.roomCode || !this.fb) return;
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}/pointers/${this.memberId}`);
    await this.fb.remove(r);
  }

  // Streams the other participants' pointers (our own slot is filtered out, as
  // the pointing device shows its own pointer locally with no round-trip). The
  // callback receives a map of memberId -> { x, y }.
  listenPointers(cb) {
    if (!this.roomCode || !this.fb) return;
    this.stopListeningPointers();
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}/pointers`);
    this.pointersUnsub = this.fb.onValue(r, (snapshot) => {
      const data = snapshot.val();
      const others = {};
      if (data && typeof data === 'object') {
        for (const [id, val] of Object.entries(data)) {
          if (id === this.memberId) continue;
          if (val && typeof val.x === 'number' && typeof val.y === 'number') {
            others[id] = { x: val.x, y: val.y };
          }
        }
      }
      cb(others);
    });
  }

  stopListeningPointers() {
    if (this.pointersUnsub) {
      this.pointersUnsub();
      this.pointersUnsub = null;
    }
  }

  // --- Shared reading memory ("mood ritual", issue #65) -------------------
  // When a synced pair finishes a book, both devices show a mood-selection
  // screen and exchange their picks under rooms/{code}/mood. Like the page
  // exchange and unlike pointers this is durable (no onDisconnect): a reader
  // who steps away mid-selection leaves the screen open for the other party.
  //   mood/open            : true once either side opens the screen (the signal
  //                          the partner's listener uses to open it too)
  //   mood/order           : [iconId…] — the random subset of moods this finish
  //                          shows, in display order. The initiator rolls it once
  //                          so both devices render the identical board.
  //   mood/picks/{memberId}: { iconId: true } — that side's current selection
  // There is no shared "lock": once both sides have picked, each device reveals
  // and stores its own perspective ({ mine, theirs }) locally, so nothing about
  // the agreement needs to be reconciled over the wire.

  moodRef(child) {
    const path = child ? `rooms/${this.roomCode}/mood/${child}` : `rooms/${this.roomCode}/mood`;
    return this.fb.ref(this.fb.db, path);
  }

  // Opens the ritual: flags the mood node so the partner's listener shows the
  // screen. Replacing the whole node in one write also wipes any leftover picks
  // or lock from an earlier finish in this room (a re-read starts blank, with no
  // hint of the previous picks) — and, being a single event rather than a
  // remove-then-set, never flashes an empty node past our own listener.
  async startMood(order) {
    if (!this.roomCode || !this.fb) return;
    // Include our own presence in the same atomic write, so it can't be wiped by
    // this very set; the fresh whole-node write also clears any stale `present`
    // (and picks) from an earlier finish, so the count reflects *this* ritual
    // only. Followers add themselves via announceMoodPresence when they open.
    await this.fb.set(this.moodRef(), { open: true, order, present: { [this.memberId]: true } });
  }

  // A follower opening the ritual in response to the `open` flag adds itself to
  // the presence set (the initiator is already in via startMood). The ~1.5 s
  // cover-close intro doubles as a settle window, so every device's count is in
  // by the time the board accepts taps. Durable like the rest of the mood node
  // (no onDisconnect): it is wiped per-ritual by startMood, never by a drop.
  async announceMoodPresence() {
    if (!this.roomCode || !this.fb) return;
    await this.fb.set(this.moodRef('present/' + this.memberId), true);
  }

  async setMoodPicks(iconIds) {
    if (!this.roomCode || !this.fb) return;
    const r = this.moodRef(`picks/${this.memberId}`);
    if (!iconIds.length) {
      await this.fb.remove(r);
      return;
    }
    const map = {};
    for (const id of iconIds) map[id] = true;
    await this.fb.set(r, map);
  }

  async clearMood() {
    if (!this.roomCode || !this.fb) return;
    await this.fb.remove(this.moodRef());
  }

  // Streams the whole mood node, parsed into { open, order, picks, present }.
  // `order` is the shared board (icon ids in display order), or null before the
  // initiator has written it. `picks` maps each participant's memberId to its
  // array of selected icon ids (our own slot included, so the caller can
  // reconcile after a reconnect). `present` is the list of memberIds that have
  // announced themselves this ritual — used only to count participants (#82).
  listenMood(cb) {
    if (!this.roomCode || !this.fb) return;
    this.stopListeningMood();
    this.moodUnsub = this.fb.onValue(this.moodRef(), (snapshot) => {
      const data = snapshot.val();
      if (!data) { cb(null); return; }
      const picks = {};
      if (data.picks && typeof data.picks === 'object') {
        for (const [id, map] of Object.entries(data.picks)) {
          picks[id] = Object.keys(map || {}).map(Number);
        }
      }
      const order = Array.isArray(data.order) ? data.order.map(Number) : null;
      const present = (data.present && typeof data.present === 'object')
        ? Object.keys(data.present)
        : [];
      cb({ open: !!data.open, order, picks, present });
    });
  }

  stopListeningMood() {
    if (this.moodUnsub) {
      this.moodUnsub();
      this.moodUnsub = null;
    }
  }

  stop() {
    this.stopListeningPointers();
    this.stopListeningMood();
    this.clearPointer().catch(() => {});
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // Nothing to hand back: the room holds no record of this device, and it is
    // the reaper's to delete once its lease runs out (ADR 27).
    activeSessions.delete(this.bookId);
    removeRoomForBook(this.bookId);
    this.roomCode = null;
    this.isCreator = false;
    this.lastUpdatedAt = null;
  }
}
