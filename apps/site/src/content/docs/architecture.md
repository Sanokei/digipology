---
title: Architecture
description: A human-readable tour of Digipology's deterministic kernel, browser renderer, creator scripting, and multiplayer sequencing.
---

Digipology treats a tabletop session as a shared, reproducible story. Everyone begins from the same snapshot, receives the same ordered actions, and runs those actions through the same versioned game kernel. If the clients are healthy, they arrive at the same state.

## The rulebook is the authority

The deterministic kernel is the platform's referee. It applies actions, runs game rules, and produces canonical state. That state is deliberately plain: finite numbers, strings, booleans, nulls, arrays, and string-keyed objects.

The kernel cannot consult a wall clock, network request, browser API, or renderer. Random outcomes come from a seeded, versioned generator. Those constraints make a session replayable and make disagreement detectable with canonical state hashes.

> **A useful mental model:** gameplay is `initial snapshot + ordered actions`, interpreted by an exact kernel version.

## The table is not the rulebook

Babylon.js will draw the table, pieces, hands, and motion. It may predict an interaction so a dragged piece feels immediate, but presentation never becomes canonical authority. A beautiful frame cannot change the rules.

That separation lets the visual layer evolve without quietly changing saved games or multiplayer results.

## Lua gives creators a safe rules language

Creators will express game-specific behavior in Lua: deal cards, advance turns, guard who may move a piece, or ask a player to choose. The Lua environment receives a documented tabletop API instead of direct access to JavaScript or the browser.

Scripts run with deterministic ordering and bounded work. They have no network, filesystem, operating-system, or arbitrary JavaScript escape. If a script fails during an action, the top-level gameplay transaction is rejected rather than leaving half-applied state behind.

Read the [Lua API preview](/docs/lua-preview/) for the proposed surface.

## The room orders; clients simulate

A Cloudflare Durable Object represents each active table. Its job is to authenticate the room session, assign sequence numbers, and broadcast one canonical order of actions. It does **not** run game rules.

Each client simulates those actions locally. Checkpoints and hashes help reconnecting clients recover and expose divergence instead of hiding it. This keeps the service focused on coordination while the versioned kernel remains the one rules engine.

## Projects become immutable releases

Creators work in mutable projects. Publishing builds a self-contained, immutable release with pinned rules, assets, and compatible engine versions. Rooms and saves point to that exact release, so a later edit cannot rewrite a game already in progress.

## Small public building blocks

The architecture is split into focused `digipology-*` packages, including canonical JSON, the deterministic PRNG, the kernel, protocol types, and the Lua host. Kernel-side packages aim for zero runtime dependencies and can be reused without adopting the whole application.

The full rationale is recorded in the repository's [accepted architecture decision](https://github.com/Sanokei/digipology/blob/main/docs/adr/0001-initial-architecture.md).
