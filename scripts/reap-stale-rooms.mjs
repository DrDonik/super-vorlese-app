// Server-side reaper for abandoned sync rooms (GitHub issue #32).
//
// Rooms persist in Firebase so that either party can reconnect after closing
// the app — that is intentional and must not change. The client only enforces
// the room's end lazily (when someone joins/reconnects to a dead code), so a
// room that is simply abandoned lingers forever. This job sweeps those.
//
// Since ADR 27 a room carries a life counter instead of a timestamp: this job
// subtracts one from every room's counter on each run and deletes the room when
// it would reach zero. That is what keeps the wall-clock out of the room — it
// says how many days of grace are left, not when anyone last read in it. The
// counter therefore only moves while this job runs; a job that stops running
// stops the ageing, which is the price of the design.
//
// Rooms from before the counter carry `updatedAt` instead and still expire by
// it. A counted room whose timestamp is still fresh is never deleted: an old
// client cannot top the counter up, and must not lose the room it is reading
// in. Both branches meet in planReap() below.
//
// Auth: a Firebase Admin SDK service-account key is provided as the
// FIREBASE_SA_KEY env var (the full JSON). The minted OAuth token bypasses the
// database security rules, which deny listing `rooms/` to ordinary clients.
//
// Usage:
//   node scripts/reap-stale-rooms.mjs            # delete stale rooms
//   node scripts/reap-stale-rooms.mjs --dry-run  # report only, delete nothing

import { pathToFileURL } from 'node:url';
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

// The whole decision, kept pure so it can be exercised without a database:
// given every room and the current time, which counters go down by one and
// which rooms go away. Exported for that reason only.
export function planReap(rooms, now = Date.now()) {
  const cutoff = now - ROOM_TTL_MS;
  const decrement = [];
  const deletions = [];
  const skipped = [];

  for (const [code, room] of Object.entries(rooms || {})) {
    const life = room?.life;
    const updatedAt = room?.updatedAt;
    // An old client keeps a room alive by writing its timestamp; while that is
    // fresh, the counter running out does not delete the room.
    const legacyDone = typeof updatedAt === 'number' ? updatedAt < cutoff : updatedAt === undefined;

    if (typeof life === 'number') {
      // Zero is a state the room rests in for a whole run, not a moment inside
      // this job: a counter above zero only ever counts down here, and a room is
      // deleted on the next run, once zero has stood for a day. A counting
      // client cannot have renewed it in between — a room that this branch
      // would delete reads as gone to every such client (roomIsGone), so none
      // of them writes to it any more. An *old* client can still write its
      // timestamp there at any moment, which is what the conditional delete
      // below is for.
      if (life > 0) decrement.push(code);
      else if (legacyDone) deletions.push(code);
      continue;
    }
    // No counter: a room from before ADR 27, or something we did not write.
    if (typeof updatedAt === 'number') {
      if (updatedAt < cutoff) deletions.push(code);
    } else {
      skipped.push(code);
    }
  }
  return { decrement, deletions, skipped };
}

// Deletes one room, but only if it still deserves it. The listing this job
// plans from is minutes old by the time it writes, and an old client — which
// knows nothing of the counter — may write its timestamp into a condemned room
// at any moment. So the room is read once more, the same rule is applied to
// that fresh state, and only then is it deleted; anything that changed is left
// standing for the next run to judge, with no retry loop to get wrong.
//
// The delete also carries `If-Match`, which makes it atomic where the database
// honours it. That is a belt over the braces, not the guard itself: the
// re-read is what this code relies on, because it holds no matter how ETags
// behave (the local emulator, for one, does not change its ETag when a field is
// added). Deletions are rare — this costs two requests on the rare day one
// happens.
//
// `request` is passed in ({ url, method, headers } -> { status, headers, body })
// so this can be exercised against an emulator without the job's credentials.
export async function deleteRoomIfStillDone(request, url, now = Date.now()) {
  const read = await request({ url, method: 'GET', headers: { 'X-Firebase-ETag': 'true' } });
  const room = read.body;
  if (!room) return 'gone';
  if (!planReap({ room }, now).deletions.length) return 'changed';

  const etag = read.headers?.etag || read.headers?.ETag;
  const res = await request({
    url,
    method: 'DELETE',
    headers: etag ? { 'If-Match': etag } : undefined,
  });
  if (res.status === 412) return 'changed';
  if (res.status >= 400) return 'failed';
  return 'deleted';
}

async function main() {
  const client = makeClient();
  // Statuses are ours to judge, not gaxios's: a 412 is the expected answer to a
  // conditional delete, not an error.
  const request = async (opts) => {
    const res = await client.request({ ...opts, validateStatus: () => true });
    return { status: res.status, headers: res.headers, body: res.data };
  };

  const { data: rooms } = await client.request({ url: `${DATABASE_URL}/rooms.json` });
  if (!rooms || typeof rooms !== 'object') {
    console.log('No rooms in the database. Nothing to reap.');
    return;
  }

  const codes = Object.keys(rooms);
  const { decrement, deletions, skipped } = planReap(rooms);

  console.log(
    `Scanned ${codes.length} room(s); ${deletions.length} to delete, ` +
      `${decrement.length} counted down` +
      (skipped.length ? `, ${skipped.length} skipped (neither counter nor timestamp)` : '') +
      '.'
  );

  if (dryRun) {
    if (deletions.length) console.log(`[dry-run] Would delete: ${deletions.join(', ')}`);
    if (decrement.length) console.log(`[dry-run] Would count down: ${decrement.join(', ')}`);
    return;
  }

  let deleted = 0;
  let spared = 0;
  for (const code of deletions) {
    const outcome = await deleteRoomIfStillDone(request, `${DATABASE_URL}/rooms/${code}.json`);
    if (outcome === 'deleted') deleted++;
    else {
      spared++;
      console.log(`Left ${code} standing (${outcome}).`);
    }
  }

  // The countdown stays a single multi-path update, with the server-side
  // increment so a top-up landing between the read and this write survives.
  if (decrement.length) {
    const payload = Object.fromEntries(
      decrement.map((code) => [`${code}/life`, { '.sv': { increment: -1 } }])
    );
    await client.request({ url: `${DATABASE_URL}/rooms.json`, method: 'PATCH', data: payload });
  }
  console.log(
    `Deleted ${deleted} room(s)` + (spared ? `, spared ${spared} that changed` : '') +
      `; counted down ${decrement.length}.`
  );
}

// Only when run as the job (the workflow calls this file directly). Importing
// it — which is how planReap is exercised — must not talk to the database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Reaper failed:', err.message);
    process.exit(1);
  });
}
