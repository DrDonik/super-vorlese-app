import { ROOM_TTL_MS, DATABASE_URL } from './sync-constants.js';

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

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
  const normalizedCode = code.toUpperCase().replace(/\s+/g, '');
  if (normalizedCode.length !== 6) {
    throw new Error('Code muss 6 Zeichen lang sein');
  }
  const r = fb.ref(fb.db, `rooms/${normalizedCode}`);
  const snapshot = await fb.get(r);
  if (!snapshot.exists()) {
    throw new Error('Raum existiert nicht');
  }
  const data = snapshot.val();
  if (data.updatedAt && Date.now() - data.updatedAt > ROOM_TTL_MS) {
    fb.remove(r).catch(() => {});
    throw new Error('Raum existiert nicht');
  }
  return { code: normalizedCode, book: data.book || null, page: data.page };
}

export function getSessionForBook(bookId) {
  return activeSessions.get(bookId) || null;
}

// Removes this device's membership from a room and, if that leaves the room
// empty, deletes the whole room. A room stays alive as long as at least one
// participant still has the sync set up (issue #50) — only an explicit
// disconnect (here or via SyncSession.stop) counts towards deletion, never a
// dropped connection. Abandoned rooms are reaped server-side by the TTL.
function leaveRoom(fb, code, memberId) {
  // Legacy rooms saved before presence tracking carry no memberId; there is
  // nothing of ours to remove, so leave cleanup to the server-side reaper.
  if (!memberId) return Promise.resolve();
  const memberRef = fb.ref(fb.db, `rooms/${code}/members/${memberId}`);
  return fb.remove(memberRef)
    .then(() => fb.get(fb.ref(fb.db, `rooms/${code}/members`)))
    .then((snapshot) => {
      if (!snapshot.exists()) {
        return fb.remove(fb.ref(fb.db, `rooms/${code}`));
      }
    });
}

export function closeSyncForBook(bookId) {
  const session = activeSessions.get(bookId);
  if (session) {
    session.stop();
  } else {
    const saved = getSavedRoom(bookId);
    if (saved) {
      loadFirebase()
        .then((fb) => leaveRoom(fb, saved.code, saved.memberId))
        .catch(() => {});
    }
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
    this.clientId = Math.random().toString(36).substring(2, 9);
    this.fb = null;
  }

  async createRoom(initialPage, bookDescriptor = null) {
    this.fb = await loadFirebase();
    let code, r;
    for (let i = 0; i < 5; i++) {
      code = generateRoomCode();
      r = this.fb.ref(this.fb.db, `rooms/${code}`);
      const snapshot = await this.fb.get(r);
      if (!snapshot.exists()) break;
      if (i === 4) throw new Error('Kein freier Raum-Code gefunden. Bitte erneut versuchen.');
    }
    const payload = {
      page: initialPage,
      senderId: this.clientId,
      updatedAt: this.fb.serverTimestamp(),
    };
    // The book descriptor lets a partner who joins from the library recognise
    // the book and fetch it if they don't already have it.
    if (bookDescriptor) payload.book = bookDescriptor;
    await this.fb.set(r, payload);
    this.roomCode = code;
    this.isCreator = true;
    activeSessions.set(this.bookId, this);
    saveRoomForBook(this.bookId, code, true, this.clientId);
    this.enrollMember();
    this.listen();
    return code;
  }

  async joinRoom(code) {
    this.fb = await loadFirebase();
    const normalizedCode = code.toUpperCase().replace(/\s+/g, '');
    if (normalizedCode.length !== 6) {
      throw new Error('Code muss 6 Zeichen lang sein');
    }
    const r = this.fb.ref(this.fb.db, `rooms/${normalizedCode}`);
    const snapshot = await this.fb.get(r);
    if (!snapshot.exists()) {
      throw new Error('Raum existiert nicht');
    }
    const data = snapshot.val();
    if (data.updatedAt && Date.now() - data.updatedAt > ROOM_TTL_MS) {
      this.fb.remove(r).catch(() => {});
      throw new Error('Raum existiert nicht');
    }
    this.roomCode = normalizedCode;
    this.isCreator = false;
    activeSessions.set(this.bookId, this);
    saveRoomForBook(this.bookId, normalizedCode, false, this.clientId);
    this.enrollMember();
    this.listen();
    return normalizedCode;
  }

  // Registers this device in the room's durable member set. Membership marks
  // "I still have this sync set up" — it is deliberately NOT tied to the live
  // connection (no onDisconnect), so closing the app or losing the network
  // leaves it intact and the sync is still there on the next reconnect.
  enrollMember() {
    if (!this.roomCode || !this.fb) return;
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}/members/${this.clientId}`);
    this.fb.set(r, this.fb.serverTimestamp()).catch(() => {});
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
      if (data.senderId !== this.clientId && this.onRemotePageChange) {
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
    if (data.updatedAt && Date.now() - data.updatedAt > ROOM_TTL_MS) {
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
    // Reuse the persisted member id so reconnecting refreshes our existing
    // membership instead of orphaning it under a fresh id. Legacy saved rooms
    // have none yet, so we adopt this session's id and persist it now.
    if (saved.memberId) this.clientId = saved.memberId;
    activeSessions.set(this.bookId, this);
    saveRoomForBook(this.bookId, saved.code, saved.isCreator, this.clientId);
    this.enrollMember();
    this.listen();
    return saved.code;
  }

  detach() {
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
    // update (not set) so the page exchange never clobbers the room's book
    // descriptor or an in-flight WebRTC signalling handshake.
    await this.fb.update(r, {
      page,
      senderId: this.clientId,
      updatedAt: this.fb.serverTimestamp(),
    });
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // Drop our membership; the room is deleted only once nobody is left in it.
    if (this.roomCode && this.fb) {
      leaveRoom(this.fb, this.roomCode, this.clientId).catch(() => {});
    }
    activeSessions.delete(this.bookId);
    removeRoomForBook(this.bookId);
    this.roomCode = null;
    this.isCreator = false;
  }
}
