---
title: Lua API preview
description: An early look at the deterministic, sandboxed tabletop API proposed for Digipology creators.
---

> **Preview—subject to change.** This page distills the current creator API direction. Digipology is not playable yet, and this is not the final Lua v1 reference.

Lua will describe tabletop rules, not browser or rendering implementation. A script can work with game state and semantic tabletop objects while the platform controls ordering, persistence, and safety.

## Environment at a glance

The proposed v1 environment exposes these namespaces and values:

| Surface | Purpose |
| --- | --- |
| `state` | Canonical values that must survive and affect future play |
| `refs` | Stable editor-defined references to entities |
| `settings` | Read-only room configuration chosen at start |
| `game` | Game-level behavior and context |
| `scene` | Find, query, spawn, and destroy entities |
| `players` | Stable access to players and seats |
| `random` | Seeded integers, floats, choices, and shuffles |
| `timer` | Reconstructable named callbacks |
| `ui` | Prompts and confirmations with canonical responses |
| `data` | Packaged release data |
| `self`, `props` | The current entity and its editor-authored binding values |

Collection ordering that can affect a script is explicit and deterministic. Random calls use the session's seeded generator—not Lua or browser entropy.

## Tabletop objects, not renderer objects

Scripts work with semantic proxies such as `Card`, `Deck`, `Hand`, `Container`, `Die`, `Counter`, `Zone`, `SnapPoint`, `Button`, `Text`, and `Player`.

```lua
refs.main_deck:shuffle()
refs.score:add(1)
ctx.player.hand:add(card)
self:flip()
```

A deck knows how to deal; a card knows how to flip; a counter knows how to add. None of those operations expose Babylon.js or arbitrary JavaScript.

## The current example

This is the start-and-guard example from the proposed API:

```lua
function on_start(ctx)
    state.turn = 1
    refs.main_deck:shuffle()
    for _, player in ipairs(players:list()) do
        if player.hand then refs.main_deck:deal(player, 5) end
    end
end

function can_grab(ctx)
    return ctx.player.seat.id == props.seat_id,
        "Only this seat may move this piece."
end
```

`on_start` may queue gameplay changes. `can_grab` is a read-only guard: it can allow or deny the interaction and give the player a reason, but it cannot mutate canonical state.

## The sandbox promise

Lua is treated as hostile input. The sandbox exposes only the documented API:

- no network, filesystem, operating-system, DOM, or arbitrary JavaScript access;
- only packaged project or platform modules through `require()`;
- canonical-compatible persistent values—no functions, userdata, cycles, or nonfinite numbers;
- bounded instructions, recursion, memory growth, and queued commands;
- deterministic callback and event-subscriber order.

A canonical script error records useful context and rejects the whole top-level action. That atomic boundary prevents a broken script from leaving gameplay half changed.

When the full Lua v1 reference lands, it will use this docs section's `title` and `description` frontmatter contract so reference pages can be added without a second rendering system.
