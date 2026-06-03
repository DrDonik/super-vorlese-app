# 11. Refresh the PWA when it returns to the foreground

Date: 2026-06-03

## Status

Accepted

## Context

The app is installed as a PWA and updated by redeploying. With
`registerType: 'autoUpdate'`, vite-plugin-pwa builds a service worker that
activates immediately and reloads the page once a new version is found. The
catch is *when the browser looks for a new version*: only on a real page load
(a fresh navigation / launch) plus the browser's own periodic schedule.

On iOS an installed, standalone PWA that is left without force-quitting is
**suspended**, not closed. Returning to it resumes the frozen page rather than
performing a fresh load, so no update check ever runs, and iOS does not run
the periodic background check on a frozen page. In practice a new version only
landed after a force-quit, a reboot, or the system evicting the app under
memory pressure — i.e. on no predictable schedule, possibly never for a user
who simply keeps returning to the suspended app. Android and desktop are
unaffected: closing the app unloads the page, so the next launch picks up the
update.

The whole point of the app is laypeople — six-year-olds and grandparents —
using it with no intervention, so silently running a weeks-old version is a
real problem.

## Decision

Register the service worker manually (set `injectRegister: null` so the plugin
does not also inject its own registration) and, on `visibilitychange`, call
`registration.update()` whenever the document becomes visible again. The
`visibilitychange` event *does* fire when iOS resumes a suspended PWA, so this
runs the update check at exactly the moment the user comes back.

`registerType` stays `autoUpdate`: when the check finds a new version it
activates and reloads on its own. We deliberately do **not** gate the reload to
a "safe" screen — the check (and therefore any reload) runs no matter where the
user is in the app. The two participants in a reading session switch between the
video-call app and this app constantly, so foregrounding happens often and
updates land quickly. A reload only ever happens right after a deploy, so the
chance of it interrupting an active reading session is small, and was judged an
acceptable trade for the minimal, simple implementation.

## Consequences

- iOS installed PWAs now pick up a new version the next time the app is
  foregrounded, instead of only after a force-quit/reboot/eviction. Android and
  desktop are unchanged.
- This behaviour ships *as* an update, so each existing install must first
  receive it the old way (one more force-quit on iOS, or the next fresh launch
  elsewhere). No reinstall is needed, and from then on updates are automatic.
- A reload can occur immediately when a reader returns to the app, even
  mid-session — it resets the current page and briefly drops the WebRTC sync.
  This is rare (only with a pending deploy) and self-heals on reconnect. If it
  proves disruptive, revisit by confining the reload to the library screen or
  prompting the user instead.
