const firebaseConfig = {
  apiKey: "AIzaSyDeI6LYnu-34xlnAx7Onjwa_bI52boW8GM",
  authDomain: "super-vorlese-app.firebaseapp.com",
  databaseURL: "https://super-vorlese-app-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "super-vorlese-app",
  storageBucket: "super-vorlese-app.firebasestorage.app",
  messagingSenderId: "759114747696",
  appId: "1:759114747696:web:d2c1718b08bf68d83282f5"
};

const ROOM_TTL_MS = 30 * 60 * 1000;

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

export class SyncSession {
  constructor() {
    this.roomCode = null;
    this.unsubscribe = null;
    this.onRemotePageChange = null;
    this.onRoomDeleted = null;
    this.isCreator = false;
    this.clientId = Math.random().toString(36).substring(2, 9);
    this.fb = null;
    this._unsubConnected = null;
    this._stopped = false;
    this._resuming = false;
  }

  async createRoom(initialPage) {
    this._stopped = false;
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
    await this.fb.onDisconnect(r).update({ disconnectedAt: this.fb.serverTimestamp() });
    if (this._stopped) {
      this.fb.onDisconnect(r).cancel().catch(() => {});
      this.fb.remove(r).catch(() => {});
      throw new Error('Aktion abgebrochen');
    }
    this.roomCode = code;
    this.isCreator = true;
    this._setupConnectionListener();
    this.listen();
    return code;
  }

  async joinRoom(code) {
    this._stopped = false;
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
    if (data.disconnectedAt) {
      const offsetSnap = await this.fb.get(this.fb.ref(this.fb.db, '.info/serverTimeOffset')).catch(() => null);
      if (this._stopped) throw new Error('Aktion abgebrochen');
      const serverTime = Date.now() + (offsetSnap?.val() || 0);
      if (serverTime - data.disconnectedAt > ROOM_TTL_MS) {
        this.fb.remove(r).catch(() => {});
        throw new Error('Raum existiert nicht');
      }
    }
    if (this._stopped) throw new Error('Aktion abgebrochen');
    this.roomCode = normalizedCode;
    this.isCreator = false;
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

  async sendPage(page) {
    if (!this.roomCode || !this.fb) return;
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
    await this.fb.set(r, {
      page,
      senderId: this.clientId,
      updatedAt: this.fb.serverTimestamp(),
    });
  }

  _setupConnectionListener() {
    this._removeConnectionListener();
    const connectedRef = this.fb.ref(this.fb.db, '.info/connected');
    let isFirstCall = true;
    this._unsubConnected = this.fb.onValue(connectedRef, (snap) => {
      const wasFirst = isFirstCall;
      isFirstCall = false;
      if (snap.val() === true) {
        if (wasFirst) return;
        this._onResume();
      }
    });
  }

  _removeConnectionListener() {
    if (this._unsubConnected) {
      this._unsubConnected();
      this._unsubConnected = null;
    }
  }

  async _onResume() {
    if (!this.roomCode || !this.fb || !this.isCreator || this._stopped || this._resuming) return;
    this._resuming = true;
    try {
      const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
      const snapshot = await this.fb.get(r);
      if (!this.roomCode || !this.isCreator || this._stopped) return;
      if (!snapshot.exists()) {
        this.stop();
        if (this.onRoomDeleted) this.onRoomDeleted();
        return;
      }
      await this.fb.onDisconnect(r).cancel().catch(() => {});
      if (!this.roomCode || !this.isCreator || this._stopped) return;
      await this.fb.onDisconnect(r).update({ disconnectedAt: this.fb.serverTimestamp() });
      if (!this.roomCode || !this.isCreator || this._stopped) return;
      await this.fb.update(r, { disconnectedAt: null });
    } catch (_) {
    } finally {
      this._resuming = false;
    }
  }

  pause() {
    this._stopped = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this._removeConnectionListener();
  }

  stop() {
    this.pause();
    if (this.roomCode && this.fb && this.isCreator) {
      const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
      this.fb.onDisconnect(r).cancel().catch(() => {});
      this.fb.remove(r).catch(() => {});
    }
    this.roomCode = null;
    this.isCreator = false;
  }
}
