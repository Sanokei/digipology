---
title: Architecture
description: A human-readable tour of Digipology's live play platform, deterministic kernel, browser renderer, creator scripting, and multiplayer rooms.
---

Digipology treats a tabletop session as a shared, reproducible story. Everyone begins from the same snapshot, receives the same ordered actions, and runs those actions through the same versioned game kernel. If the clients are healthy, they arrive at the same state.

That model now powers the first playable slice at [play.digipology.com](https://play.digipology.com): open a room, share its invite, and meet at the same browser-native table.

## Two front doors, one play origin

[digipology.com](https://digipology.com) is the public site and field guide. [play.digipology.com](https://play.digipology.com) is the application.

Behind the play subdomain, one Cloudflare Worker serves three parts of the platform on one origin: the browser app, the `/api/*` HTTP API, and each Room Durable Object's WebSocket connection. The browser does not have to cross origins to create a room, load a release, or connect to the live table. Sessions remain first-party and the play platform moves as one deployable unit.

## The rulebook is the authority

The deterministic kernel is the platform's referee. It applies actions, runs game rules, and produces canonical state. That state is deliberately plain: finite numbers, strings, booleans, nulls, arrays, and string-keyed objects.

The kernel cannot consult a wall clock, network request, browser API, or renderer. Random outcomes come from a seeded, versioned generator. Those constraints make a session replayable and make disagreement detectable with canonical state hashes.

> **A useful mental model:** gameplay is `initial snapshot + ordered actions`, interpreted by an exact kernel version.

## The table is not the rulebook

Babylon.js draws the table, pieces, hands, and motion. It may predict an interaction so a dragged piece feels immediate, but presentation never becomes canonical authority. A beautiful frame cannot change the rules.

That separation lets the visual layer evolve without quietly changing saved games or multiplayer results.

## Rooms gather players; clients run the game

A table can be private or public. Private rooms are made to share directly; their invite URLs carry an unambiguous `XXXX-XXXX` join code. Public rooms require an account to create and can appear in room discovery. Each room pins the exact game release it is playing, so an update cannot rewrite a session already underway.

A Cloudflare Durable Object represents each active room. Its job is to authenticate the room session, assign sequence numbers, and broadcast one canonical order of actions. It does **not** run game rules. Every client simulates the ordered actions locally with the same kernel and release.

Checkpoints and hashes help reconnecting clients recover and expose divergence instead of hiding it. The room service stays focused on coordination while the versioned kernel remains the one rules engine.

## An invite is enough for a guest

Accounts use passwordless email magic links—there are no passwords to store or remember. A guest can join an invited room with only a display name, and can create a private room without signing in. An account is required to create a publicly discoverable room, upload or publish a game, and use future library and persistent-save features.

## Lua gives creators a safe rules language

Creators express game-specific behavior in Lua: deal cards, advance turns, guard who may move a piece, or ask a player to choose. The Lua environment receives a documented tabletop API instead of direct access to JavaScript or the browser.

Scripts run with deterministic ordering and bounded work. They have no network, filesystem, operating-system, or arbitrary JavaScript escape. If a script fails during an action, the top-level gameplay transaction is rejected rather than leaving half-applied state behind.

Read the [Lua API v1 reference](/docs/lua-api/) for the creator-facing contract.

## Projects become immutable releases

Creators work in mutable projects. Publishing builds a self-contained, immutable release with pinned rules, assets, and compatible engine versions. Rooms and saves point to that exact release, so a later edit cannot rewrite a game already in progress.

## Small public building blocks

The architecture is split into focused `digipology-*` packages, including canonical JSON, the deterministic PRNG, the kernel, protocol types, and the Lua host. Kernel-side packages aim for zero runtime dependencies and can be reused without adopting the whole application.

The repository records the detailed rationale in [ADR-0001](https://github.com/Sanokei/digipology/blob/main/docs/adr/0001-initial-architecture.md) and the [play platform decision, ADR-0002](https://github.com/Sanokei/digipology/blob/main/docs/adr/0002-play-platform-auth-rooms.md).
