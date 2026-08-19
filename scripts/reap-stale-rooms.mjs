// Server-side reaper for abandoned sync rooms (GitHub issue #32).
//
// Rooms persist in Firebase so that either party can reconnect after closing
// the app — that is intentional and must not change. Clients never delete a
// room they are done with (ADR 27): they cannot tell whether the other side is
// still reading, and asking would mean keeping a record of who is in the room.
// So every room ends here, once its lease has run out.
//
// The lease is `updatedAt`, a server timestamp written when the room is created
// and renewed at most once a month by a page turn (ADR 27). It says a room is
// still in use, not when anybody last read in it. This job deletes the rooms
// whose lease is older than ROOM_TTL_MS + REAP_GRACE_MS — one day past the point
// where every client already treats the code as gone, so nothing can renew a
// room between this job's listing and its write.
//
// Auth: a Firebase Admin SDK service-account key is provided as the
// FIREBASE_SA_KEY env var (the full JSON). The minted OAuth token bypasses the
// database security rules, which deny listing `rooms/` to ordinary clients.
//
// Usage:
//   node scripts/reap-stale-rooms.mjs            # delete stale rooms
//   node scripts/reap-stale-rooms.mjs --dry-run  # report only, delete nothing

import { JWT } from 'google-auth-library';
import { ROOM_TTL_MS, REAP_GRACE_MS, DATABASE_URL } from '../src/sync-constants.js';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
];

const dryRun = process.argv.includes('--dry-run');

function makeClient() {
  const raw = process.env.FIREBASE_SA_KEY;
  if (!raw) {
    throw new Error('FIREBASE_SA_KEY is not set (expected the service-account JSON).');
  }
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SA_KEY is not valid JSON.');
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('FIREBASE_SA_KEY is missing client_email or private_key.');
  }
  return new JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES });
}

async function main() {
  const client = makeClient();
  const cutoff = Date.now() - ROOM_TTL_MS - REAP_GRACE_MS;

  const { data: rooms } = await client.request({ url: `${DATABASE_URL}/rooms.json` });
  if (!rooms || typeof rooms !== 'object') {
    console.log('No rooms in the database. Nothing to reap.');
    return;
  }

  const codes = Object.keys(rooms);
  const stale = [];
  let skipped = 0;
  for (const code of codes) {
    const updatedAt = rooms[code]?.updatedAt;
    // Every valid room carries a numeric server timestamp (enforced by the DB
    // rules). Anything without one is left untouched rather than risk deleting
    // fresh or unexpected data.
    if (typeof updatedAt !== 'number') {
      skipped++;
      continue;
    }
    if (updatedAt < cutoff) stale.push(code);
  }

  console.log(
    `Scanned ${codes.length} room(s); ${stale.length} stale (lease older than ` +
      `${(ROOM_TTL_MS + REAP_GRACE_MS) / 86400000} days)` +
      (skipped ? `, ${skipped} skipped (no numeric updatedAt)` : '') +
      '.'
  );

  if (stale.length === 0) return;

  // Counts only, never the codes themselves: this repository is public, so its
  // Actions logs are too, and a room code is all anyone needs to read a room.
  if (dryRun) {
    console.log(`[dry-run] Would delete ${stale.length} room(s).`);
    return;
  }

  // Delete every stale room in a single multi-path update (each code mapped to
  // null) rather than one round-trip per room.
  const payload = Object.fromEntries(stale.map((code) => [code, null]));
  await client.request({ url: `${DATABASE_URL}/rooms.json`, method: 'PATCH', data: payload });
  console.log(`Deleted ${stale.length} stale room(s).`);
}

main().catch((err) => {
  console.error('Reaper failed:', err.message);
  process.exit(1);
});
