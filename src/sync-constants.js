// Constants shared between the browser sync client (src/sync.js) and the
// server-side reaper (scripts/reap-stale-rooms.mjs). Keeping them here means
// the room lifetime and database location can never drift between the client
// that writes rooms and the job that reaps abandoned ones.

// How long a room survives without anyone turning a page in it, and the point
// at which a client treats a code as gone. 45 days, so a pair that reads once
// in a while keeps its code across a long summer break.
export const ROOM_TTL_MS = 45 * 24 * 60 * 60 * 1000; // 45 days

// How stale `updatedAt` has to be before a page turn refreshes it (ADR 27).
// The room's timestamp is a lease renewal, not a reading log: it is written
// once when the room is created and then at most once a month, riding a page
// write that happens anyway. Must stay comfortably below ROOM_TTL_MS — the gap
// between the two is how long a room has left after its last renewal.
export const ROOM_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The reaper waits one further day past the TTL before deleting (ADR 27). A
// room it condemns therefore reads as gone to every client already, so no
// client can renew it in the seconds between the job's listing and its write,
// and the deletion needs no conditional request.
export const REAP_GRACE_MS = 24 * 60 * 60 * 1000; // 1 day

export const DATABASE_URL =
  'https://super-vorlese-app-default-rtdb.europe-west1.firebasedatabase.app';
