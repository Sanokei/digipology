---
title: Getting started
description: What you can explore today, what is still being built, and where to follow Digipology's progress.
---

Digipology is in **early development**. There is not a playable table, creator, account system, or public game library yet. This documentation is the foundation those tools will grow into—not a promise that they already exist.

## What you can do today

You can follow the public engineering work, read the architecture decisions, and inspect the small `digipology-*` packages as they land.

- [Browse the Digipology repository](https://github.com/Sanokei/digipology) for source, issues, and accepted architecture decisions.
- [Find Digipology packages on npm](https://www.npmjs.com/search?q=digipology-) as reusable parts of the platform become available.
- Read [the architecture overview](/docs/architecture/) to understand why the game kernel, renderer, and multiplayer service have separate jobs.
- Preview [the creator-facing Lua API](/docs/lua-preview/) that game rules will use.

## The intended path

Eventually, a creator will assemble a tabletop project in the browser, add rules with Lua when needed, playtest it, and publish an immutable release. A player will open an invitation and join from the browser without installing native software.

That complete path does not work yet. The project is building its deterministic foundations first so later multiplayer play is reproducible instead of merely plausible.

## Want to contribute?

Start with the repository's open issues and read the local contributor guidance before changing code. The specification is directional; accepted architecture decisions in `docs/adr/` explain how it is being implemented.

Next: [see how the platform fits together](/docs/architecture/).
