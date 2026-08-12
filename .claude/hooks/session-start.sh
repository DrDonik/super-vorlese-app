#!/bin/bash
# Installs dependencies so a Claude Code on the web session can build and run
# the app right away. Runs on every session start (startup, resume, clear).
set -euo pipefail

# Local checkouts manage their own node_modules; only the fresh cloud container
# needs this.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

# The harness sets CLAUDE_PROJECT_DIR; fall back to this script's own location
# so an unset variable installs the dependencies instead of aborting on set -u.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# `npm ci`, not `npm install`: the container ships npm 10, while the lockfile is
# written by npm 11, so `npm install` rewrites package-lock.json on every start
# and leaves the working tree dirty before any work begins. `npm ci` never
# writes the lockfile, and with the warm ~/.npm cache it is the faster of the
# two anyway. It does fail loudly when package.json and the lockfile disagree —
# regenerate and commit the lockfile when adding a dependency.
#
# npm writes node_modules/.package-lock.json at the end of every install, so a
# marker newer than both manifests means the installed tree is already current.
# package.json has to be part of that comparison: editing it alone leaves the
# lockfile untouched, and skipping on that would hide the very disagreement
# npm ci exists to report.
if [ ! -e node_modules/.package-lock.json ] ||
   [ ! node_modules/.package-lock.json -nt package-lock.json ] ||
   [ ! node_modules/.package-lock.json -nt package.json ]; then
  # A SessionStart hook's stdout becomes context Claude reads, so the install
  # chatter goes to stderr and only a failure is worth a word. Report that on
  # both streams: stdout reaches Claude, and exit 2 is the one code that shows
  # stderr to the user — every other non-zero code is treated like success.
  if ! npm ci --no-audit --no-fund >&2; then
    echo "session-start hook: npm ci failed, dependencies are NOT installed."
    echo "session-start hook: npm ci failed, dependencies are NOT installed." >&2
    exit 2
  fi
fi
