# 1. Record architecture decisions

Date: 2026-05-28

## Status

Accepted

## Context

We need a lightweight, durable way to record significant decisions about the architecture and product scope of this app, so that future contributors (and our future selves) can understand why things are the way they are without having to reconstruct the reasoning from chat logs or commit messages.

## Decision

We will use Architecture Decision Records (ADRs), as described by Michael Nygard in [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

ADRs live in `doc/adr/`, numbered sequentially (`NNNN-title-in-kebab-case.md`). Each ADR has a short, fixed structure: Status, Context, Decision, Consequences.

ADRs are immutable once accepted. To change a decision, write a new ADR that supersedes the old one; mark the old one's status as "Superseded by NNNN" rather than editing its content.

## Consequences

- The reasoning behind non-obvious decisions is captured close to the code, in the repo, and reviewed like any other change.
- New contributors have a chronological record of how the architecture evolved.
- Small overhead per decision (a few paragraphs of writing) — only worth doing for decisions with non-trivial consequences or trade-offs. Day-to-day implementation choices do not need an ADR.
