// Server-side deployer for the Realtime Database security rules (GitHub issue
// #51).
//
// The rules live in `database.rules.json` and used to be pushed by hand
// (`firebase deploy --only database`). That is a footgun: the app deploys
// automatically on every push to main, so a forgotten manual rules deploy lets
// the live rules drift from the repo and silently reject the new app's writes.
// This script publishes the rules from CI so they can never drift, and so they
// land *before* the app build (see deploy.yml and ADR 0006).
//
// Auth mirrors the reaper (scripts/reap-stale-rooms.mjs): a Firebase Admin SDK
// service-account key is supplied as the FIREBASE_SA_KEY env var (the full
// JSON), and the minted OAuth token is allowed to update the database rules via
// the `.settings/rules.json` REST endpoint.
//
// Usage:
//   node scripts/deploy-rules.mjs            # publish database.rules.json
//   node scripts/deploy-rules.mjs --dry-run  # validate only, publish nothing

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JWT } from 'google-auth-library';
import { DATABASE_URL } from '../src/sync-constants.js';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
];

const RULES_PATH = fileURLToPath(new URL('../database.rules.json', import.meta.url));

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
  // Parse the rules locally first: this catches a malformed file before we
  // touch the live database, and gives the REST call a canonical JSON body.
  const source = await readFile(RULES_PATH, 'utf8');
  let rules;
  try {
    rules = JSON.parse(source);
  } catch {
    throw new Error('database.rules.json is not valid JSON.');
  }

  if (dryRun) {
    console.log('[dry-run] database.rules.json is valid JSON; would publish to .settings/rules.json.');
    return;
  }

  const client = makeClient();
  await client.request({
    url: `${DATABASE_URL}/.settings/rules.json`,
    method: 'PUT',
    data: rules,
  });
  console.log('Published database.rules.json to the live database rules.');
}

main().catch((err) => {
  console.error('Rules deploy failed:', err.message);
  // On a rejected deploy the REST API returns the actual rules
  // compilation/validation error in the response body, not in err.message
  // (which is just "Request failed with status code 400"). Surface it so CI
  // logs show what to fix.
  if (err.response?.data) {
    console.error('Response details:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
