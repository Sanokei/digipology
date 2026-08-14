---
title: Getting started
description: What you can explore today, what is still being built, and where to follow Digipology's progress.
---

Digipology is in **early access**. The first playable slice is live: you can open a room for a built-in game, share its invite, and play together in the browser. The creator and publishing tools are still being built in the open.

## What you can do today

You can play today, follow the public engineering work, read the architecture decisions, and inspect the small `digipology-*` packages as they land.

- [Open Digipology Play](https://play.digipology.com) to create or join a room.
- [Browse the Digipology repository](https://github.com/Sanokei/digipology) for source, issues, and accepted architecture decisions.
- [Find Digipology packages on npm](https://www.npmjs.com/search?q=digipology-) as reusable parts of the platform become available.
- Read [the architecture overview](/docs/architecture/) to understand why the game kernel, renderer, and multiplayer service have separate jobs.
- Read [the creator-facing Lua API v1 reference](/docs/lua-api/) that game rules use.

## The intended path

The live room experience is one part of the intended loop. A creator will assemble a tabletop project in the browser, add rules with Lua when needed, playtest it, and publish an immutable release. A player can already open an invitation and join from the browser without installing native software; the creator path is the next part taking shape.

## Want to contribute?

Start with the repository's open issues and read the local contributor guidance before changing code. The specification is directional; accepted architecture decisions in `docs/adr/` explain how it is being implemented.

Next: [see how the platform fits together](/docs/architecture/).
