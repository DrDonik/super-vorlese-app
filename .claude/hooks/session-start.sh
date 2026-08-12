#!/bin/bash
# Installs dependencies so a Claude Code on the web session can build and run
# the app right away. Runs on every session start (startup, resume, clear).
set -euo pipefail

# Local checkouts manage their own node_modules; only the fresh cloud container
# needs this.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "$CLAUDE_PROJECT_DIR"

# `npm ci`, not `npm install`: the container ships npm 10, while the lockfile is
# written by npm 11, so `npm install` rewrites package-lock.json on every start
# and leaves the working tree dirty before any work begins. `npm ci` never
# writes the lockfile, and with the warm ~/.npm cache it is the faster of the
# two anyway. It does fail loudly when package.json and the lockfile disagree —
# regenerate and commit the lockfile when adding a dependency.
#
# npm writes node_modules/.package-lock.json at the end of every install, so a
# marker newer than the lockfile means the installed tree is already current.
if [ ! -e node_modules/.package-lock.json ] ||
   [ ! node_modules/.package-lock.json -nt package-lock.json ]; then
  npm ci --no-audit --no-fund
fi
