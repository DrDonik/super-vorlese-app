const firebaseConfig = {
  apiKey: "AIzaSyDeI6LYnu-34xlnAx7Onjwa_bI52boW8GM",
  authDomain: "super-vorlese-app.firebaseapp.com",
  databaseURL: "https://super-vorlese-app-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "super-vorlese-app",
  storageBucket: "super-vorlese-app.firebasestorage.app",
  messagingSenderId: "759114747696",
  appId: "1:759114747696:web:d2c1718b08bf68d83282f5"
};

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

export function getSessionForBook(bookId) {
  return activeSessions.get(bookId) || null;
}

export function closeSyncForBook(bookId) {
  const session = activeSessions.get(bookId);
  if (session) {
    session.stop();
    activeSessions.delete(bookId);
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
    await this.fb.onDisconnect(r).remove();
    this.roomCode = code;
    this.isCreator = true;
    activeSessions.set(this.bookId, this);
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
    this.roomCode = normalizedCode;
    this.isCreator = false;
    activeSessions.set(this.bookId, this);
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

  detach() {
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
      this.fb.onDisconnect(r).cancel().catch(() => {});
      this.fb.remove(r).catch(() => {});
    }
    activeSessions.delete(this.bookId);
    this.roomCode = null;
    this.isCreator = false;
  }
}
