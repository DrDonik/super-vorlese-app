// Constants shared between the browser sync client (src/sync.js) and the
// server-side reaper (scripts/reap-stale-rooms.mjs). Keeping them here means
// the room time-to-live and database location can never drift between the
// client that writes rooms and the job that reaps stale ones.

export const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const DATABASE_URL =
  'https://super-vorlese-app-default-rtdb.europe-west1.firebasedatabase.app';
