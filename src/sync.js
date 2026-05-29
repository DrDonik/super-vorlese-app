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

function saveRoomForBook(bookId, roomCode, isCreator) {
  const rooms = loadSavedRooms();
  rooms[bookId] = { code: roomCode, isCreator };
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

export function getSessionForBook(bookId) {
  return activeSessions.get(bookId) || null;
}

export function closeSyncForBook(bookId) {
  const session = activeSessions.get(bookId);
  if (session) {
    session.stop();
  } else {
    const saved = getSavedRoom(bookId);
    if (saved && saved.isCreator) {
      loadFirebase().then((fb) => {
        const r = fb.ref(fb.db, `rooms/${saved.code}`);
        fb.remove(r).catch(() => {});
      }).catch(() => {});
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

  async createRoom(initialPage) {
    this.fb = await loadFirebase();
    let code, r;
    for (let i = 0; i < 5; i++) {
      code = generateRoomCode();
      r = this.fb.ref(this.fb.db, `rooms/${code}`);
      const snapshot = await this.fb.get(r);
      if (!snapshot.exists()) break;
      if (i === 4) throw new Error('Kein freier Raum-Code gefunden. Bitte erneut versuchen.');
    }
    await this.fb.set(r, {
      page: initialPage,
      senderId: this.clientId,
      updatedAt: this.fb.serverTimestamp(),
    });
    this.roomCode = code;
    this.isCreator = true;
    activeSessions.set(this.bookId, this);
    saveRoomForBook(this.bookId, code, true);
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
    saveRoomForBook(this.bookId, normalizedCode, false);
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
    activeSessions.set(this.bookId, this);
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
    await this.fb.set(r, {
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
    if (this.roomCode && this.fb && this.isCreator) {
      const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
      this.fb.remove(r).catch(() => {});
    }
    activeSessions.delete(this.bookId);
    removeRoomForBook(this.bookId);
    this.roomCode = null;
    this.isCreator = false;
  }
}
