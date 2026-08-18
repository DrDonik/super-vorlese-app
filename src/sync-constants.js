// Constants shared between the browser sync client (src/sync.js) and the
// server-side reaper (scripts/reap-stale-rooms.mjs). Keeping them here means
// the room lifetime and database location can never drift between the client
// that writes rooms and the job that reaps stale ones.

// A room's remaining life, counted in reaper runs rather than in wall-clock
// time (ADR 27). The client sets the counter to ROOM_LIFE_MAX; the reaper
// subtracts one on each daily run and deletes the room when it would reach
// zero. So the room says how many days of grace are left, never at what hour
// of which evening somebody last read in it.
export const ROOM_LIFE_MAX = 30;

// The client tops the counter back up only once it has fallen below this, so a
// room that is read in every night is written to roughly once a week instead of
// every evening — one fewer thing for anyone holding the code to watch.
export const ROOM_LIFE_REFRESH_BELOW = 24;

// Rooms created before the counter carry a server timestamp instead. They keep
// expiring by it, and the reaper will not delete a counted room whose timestamp
// is still fresh — an old client that cannot top the counter up must not lose
// the room it is reading in. Once no such client is left, both may go.
export const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const DATABASE_URL =
  'https://super-vorlese-app-default-rtdb.europe-west1.firebasedatabase.app';
