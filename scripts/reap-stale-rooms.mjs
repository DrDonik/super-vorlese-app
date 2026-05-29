// Server-side reaper for abandoned sync rooms (GitHub issue #32).
//
// Rooms persist in Firebase so that either party can reconnect after closing
// the app — that is intentional and must not change. The client only enforces
// the room TTL lazily (when someone joins/reconnects to an expired code), so a
// room that is simply abandoned lingers forever. This job sweeps those: it
// lists every room and deletes the ones whose server-stamped `updatedAt` is
// older than ROOM_TTL_MS.
//
// Auth: a Firebase Admin SDK service-account key is provided as the
// FIREBASE_SA_KEY env var (the full JSON). The minted OAuth token bypasses the
// database security rules, which deny listing `rooms/` to ordinary clients.
//
// Usage:
//   node scripts/reap-stale-rooms.mjs            # delete stale rooms
//   node scripts/reap-stale-rooms.mjs --dry-run  # report only, delete nothing

import { JWT } from 'google-auth-library';
import { ROOM_TTL_MS, DATABASE_URL } from '../src/sync-constants.js';

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
  const cutoff = Date.now() - ROOM_TTL_MS;

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
    `Scanned ${codes.length} room(s); ${stale.length} stale (older than ${ROOM_TTL_MS / 86400000} days)` +
      (skipped ? `, ${skipped} skipped (no numeric updatedAt)` : '') +
      '.'
  );

  if (stale.length === 0) return;

  if (dryRun) {
    console.log(`[dry-run] Would delete: ${stale.join(', ')}`);
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
