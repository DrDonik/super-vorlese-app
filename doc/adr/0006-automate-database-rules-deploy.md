# 6. Automate database rules deployment in CI

Date: 2026-05-31

## Status

Accepted

## Context

The Realtime Database security rules live in `database.rules.json`, but until now
they were deployed **by hand** (`firebase deploy --only database`). The
`deploy.yml` workflow only builds the app and publishes it to GitHub Pages — it
never touched the rules.

This is a footgun. Every push to `main` ships the app automatically, but the
matching rules change rides along only in the repo until someone remembers to
deploy it manually. If a build relies on rules the live ruleset does not yet
have, the new app's writes get silently rejected, and the live rules can quietly
drift from the source of truth.

Two facts shaped the solution:

- **Credentials already exist.** The reaper (`scripts/reap-stale-rooms.mjs`,
  ADR-adjacent to issue #32) already authenticates to the database with the
  `FIREBASE_SA_KEY` service-account secret. It does so without `firebase-tools`:
  it mints an OAuth token via `google-auth-library` and calls the RTDB REST API
  directly. The key is an admin key, so it can also update the rules.
- **Ordering matters.** Rules should land *before* the app, because a new build
  may depend on rules the old ruleset rejects (new rules are generally
  backward-compatible with the old app, so the reverse ordering is safe).

## Decision

Deploy the database rules from CI as a **step inside the existing `deploy.yml`
job, sequenced before the app build and Pages deploy**.

- A new script, `scripts/deploy-rules.mjs`, mirrors the reaper: it parses
  `database.rules.json` locally (catching a malformed file before touching the
  live database), mints a token from `FIREBASE_SA_KEY`, and `PUT`s the rules to
  the `.settings/rules.json` REST endpoint. It supports `--dry-run` for
  validation without publishing.
- Reusing the reaper's REST/`google-auth-library` pattern keeps CI free of a
  `firebase-tools` dependency and keeps the two server-side jobs consistent.
- The rules deploy runs on **every** push to `main`. Republishing identical
  rules is idempotent, so this is simpler and more robust than path-conditional
  logic, and it guarantees the live rules always match the repo.
- Because it is a step earlier in the same job, a rules failure aborts the run
  **before** the app deploys, enforcing the rules-before-app ordering.

## Consequences

- The "forgot to deploy the rules" class of bug is gone; live rules can no longer
  drift from `database.rules.json`.
- A broken or rejected rules change fails the deploy loudly and stops the app
  from shipping against rules it may not be compatible with.
- The pipeline now depends on `FIREBASE_SA_KEY` having rules-write permission
  (Realtime Database Admin). The existing key is an admin key, so this holds; if
  the key were ever scoped down, the rules step would 403 and must be revisited.
- A small amount of work is duplicated between the reaper and the deployer (token
  minting from the service account). This is deliberate — they are independent
  jobs and the shared shape is a few lines — but if a third consumer appears, the
  auth helper is the natural thing to extract.
