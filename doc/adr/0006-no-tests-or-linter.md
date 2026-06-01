# 6. No automated tests or linter

Date: 2026-06-01

## Status

Accepted

## Context

Automated tests and linters are standard tooling suggestions. For this project, we evaluated whether adding them would reduce review iterations or catch meaningful bugs.

The review history shows that review passes address WebRTC race conditions, error-propagation strategy, sync-protocol edge cases, and similar concerns. These require understanding real-world failure modes and are not the kind of thing a test suite catches — tests verify behavior you already anticipated; reviewers surface behavior you did not.

A linter (ESLint) would catch a narrow class of real bugs (e.g. missing `await`) and reduce stylistic review noise, but adds ongoing maintenance cost (dependency updates, config tuning, rule suppression). For a solo-developer project where reviews do not cite style issues, this trade-off is not worthwhile. Adding a linter retroactively also requires either a bulk fix pass or bulk suppression, neither of which is free.

## Decision

We will not add automated tests or a linter. If this project ever gains multiple contributors or a CI pipeline, this decision should be revisited.

## Consequences

- No test or lint step to maintain or keep green.
- Agents and contributors should not propose adding tests or a linter without first re-evaluating the trade-offs in light of changed circumstances (team size, review patterns, CI setup).
- The quality bar is enforced through careful implementation and expert code review.
