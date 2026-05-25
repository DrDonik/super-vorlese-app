const firebaseConfig = {
  apiKey: "AIzaSyDeI6LYnu-34xlnAx7Onjwa_bI52boW8GM",
  authDomain: "super-vorlese-app.firebaseapp.com",
  databaseURL: "https://super-vorlese-app-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "super-vorlese-app",
  storageBucket: "super-vorlese-app.firebasestorage.app",
  messagingSenderId: "759114747696",
  appId: "1:759114747696:web:d2c1718b08bf68d83282f5"
};

let firebaseModules = null;

async function loadFirebase() {
  if (firebaseModules) return firebaseModules;
  const [appMod, dbMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/database'),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const db = dbMod.getDatabase(app);
  firebaseModules = { db, ...dbMod };
  return firebaseModules;
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
    this.localUpdate = false;
    this.fb = null;
  }

  async createRoom(initialPage) {
    this.fb = await loadFirebase();
    const code = generateRoomCode();
    const r = this.fb.ref(this.fb.db, `rooms/${code}`);
    await this.fb.set(r, { page: initialPage, updatedAt: Date.now() });
    this.fb.onDisconnect(r).remove();
    this.roomCode = code;
    this.listen();
    return code;
  }

  async joinRoom(code) {
    this.fb = await loadFirebase();
    const normalizedCode = code.toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (normalizedCode.length !== 6) {
      throw new Error('Code muss 6 Zeichen lang sein');
    }
    this.roomCode = normalizedCode;
    this.listen();
    return normalizedCode;
  }

  listen() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
    const callback = (snapshot) => {
      if (this.localUpdate) {
        this.localUpdate = false;
        return;
      }
      const data = snapshot.val();
      if (data && this.onRemotePageChange) {
        this.onRemotePageChange(data.page);
      }
    };
    this.fb.onValue(r, callback);
    this.unsubscribe = () => this.fb.off(r, 'value', callback);
  }

  async sendPage(page) {
    if (!this.roomCode || !this.fb) return;
    this.localUpdate = true;
    const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
    await this.fb.set(r, { page, updatedAt: Date.now() });
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.roomCode && this.fb) {
      const r = this.fb.ref(this.fb.db, `rooms/${this.roomCode}`);
      this.fb.remove(r).catch(() => {});
    }
    this.roomCode = null;
  }
}
