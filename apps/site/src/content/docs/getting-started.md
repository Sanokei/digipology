---
title: Getting started
description: Create, playtest, publish, discover, host, invite, and play Digipology games in the browser.
---

Digipology's full creator-to-player loop is live in the browser: **create → playtest → publish → browse → host → invite → play**. Creators can work visually in the desktop editor, add rules in Lua, or start from an AI-generated draft when the server is configured for it. Players can browse published games, Quick Play into a public room, or join a private table from an invitation.

## What you can do today

Open [Digipology Play](https://play.digipology.com) to use the shipped loop without installing native software.

- [Playing Digipology](/docs/playing/) explains Quick Play, hosting, invitations, guests, and reconnects.
- The [creator guide](/docs/creator-guide/) walks through local drafts, the docked editor, Lua scripting, in-tab playtests, and the publish handoff.
- [AI features](/docs/ai-features/) covers prompt-created drafts, editor-assisted changes, cover options, availability, and usage limits.
- The [architecture overview](/docs/architecture/) explains why the deterministic kernel, renderer, and multiplayer service have separate jobs.
- The [Lua API v1 reference](/docs/lua-api/) documents the creator-facing scripting contract.

## Create and publish

Use the desktop editor to arrange entities and components, write Lua rules, and run an isolated playtest in the same tab. When the draft is ready, the editor hands it to the create page, where the standard validation report runs before an immutable release is published. AI can prepare a reviewable game draft or propose an edit, but it never publishes automatically.

## Find a table

The catalog lists built-in and community games. Quick Play joins the fullest fresh public room for the selected game or opens a new public room when no suitable seat is available. You can also host a private room and share its eight-character code or invite URL. Guests can play and host private rooms; accounts are required for publishing and public hosting.

## Want to contribute?

Start with the repository's open issues and read the local contributor guidance before changing code. The specification is directional; accepted architecture decisions in `docs/adr/` explain how it is being implemented.

Next: [learn how to play](/docs/playing/).
