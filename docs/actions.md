---
title: Canonical action registry v1
description: The canonical v1 action vocabulary, payloads, prediction guidance, and derived events for deterministic Digipology games.
---

# Canonical action registry v1

> Lua creator methods that produce these actions are documented in the [Lua API v1 reference](./lua-api.md). This page is the creator- and implementer-facing rendering of Appendix C, not a replacement for the normative specification.

## Rejection and transaction semantics

Every service-accepted ordered action consumes one monotonically increasing `Sequence`, including an action that the game rejects. A game-semantic rejection advances the processed sequence but leaves gameplay fields unchanged. Processing a top-level action is atomic: if its validation, a script callback, or any generated subcommand fails, the kernel discards every uncommitted gameplay mutation from that transaction.

Canonical state changes only through a registered action or a deterministic subcommand generated during the current transaction. Player, script, system, and internal sources are validated independently of whether the official UI exposes the operation.

## Status legend

| Status | Meaning |
| --- | --- |
| **kernel v0** | Registered by the `digipology-kernel` implementation, with this payload checked against its code. |
| **spec** | Defined by Appendix C but not yet backed by a kernel v0 implementation in this repository. |

All entries below are **spec**. This repository does not yet contain `packages/kernel`.

> **Count divergence:** Issue #9 describes “all 27 actions,” but Appendix C contains 28 action rows. This reference includes all 28. Dropping one would diverge from the normative registry.

## Payload notation

Payloads use TypeScript-like notation. These names describe semantic types, not a published TypeScript module:

```ts
type PlayerId = string;
type SeatId = string;
type EntityId = string;
type ContainerId = EntityId;
type DeckId = EntityId;
type StackId = EntityId;
type SnapPointId = EntityId;
type PrefabId = string;
type TimerId = string;
type PromptId = string;

type CanonicalValue =
  | null
  | boolean
  | number // finite only
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

type CanonicalObject = { readonly [key: string]: CanonicalValue };
type CanonicalTransform = CanonicalObject;
type DealTarget = PlayerId | ContainerId;
```

Appendix C names payload fields but does not fully define the nested `CanonicalTransform`, settings, props, deal-target, or prompt-response schemas. The aliases above keep those gaps visible. In particular, the registry does not state whether a `container.move` endpoint can be absent, how it would encode the world, or the exact serialized shape of a transform.

## System actions

### system.game_start

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ settings: CanonicalObject }` |
| Prediction default | No |
| Status | **spec** |

Initializes the game and invokes `on_start`. The settings become canonical room-start configuration.

### system.player_joined

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ playerId: PlayerId }` |
| Prediction default | No |
| Status | **spec** |

Records a canonical player lifecycle join.

### system.player_left

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ playerId: PlayerId }` |
| Prediction default | No |
| Status | **spec** |

Records a voluntary logical departure.

### system.player_disconnected

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ playerId: PlayerId }` |
| Prediction default | No |
| Status | **spec** |

Records a grace-period-expired departure and releases objects held by that player. This action is not the transient loss of a network connection.

### system.player_removed

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ playerId: PlayerId }` |
| Prediction default | No |
| Status | **spec** |

Records a kick or administrative removal.

### system.seat_assign

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ playerId: PlayerId; seatId: SeatId }` |
| Prediction default | No |
| Status | **spec** |

Assigns the player to the seat canonically.

### system.timer_fire

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ timerId: TimerId }` |
| Prediction default | No |
| Status | **spec** |

Fires a one-shot timer exactly once. Room service schedules the timer; deterministic gameplay begins when this canonical action enters the ordered stream.

## Entity actions

### entity.grab

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | Yes |
| Status | **spec** |

The entity must be free, enabled, grabbable, and allowed by its `can_grab` guard. Continuous drag transforms are transient; the grab itself is canonical.

### entity.drop

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ entityId: EntityId; transform: CanonicalTransform }` |
| Prediction default | Yes |
| Status | **spec** |

The actor must hold the entity. The kernel validates, normalizes, and quantizes the final transform, then resolves semantic zone, snap, and stack transitions deterministically.

### entity.move

| Property | Contract |
| --- | --- |
| Allowed source | `script` or `system` |
| Payload | `{ entityId: EntityId; transform: CanonicalTransform }` |
| Prediction default | No |
| Status | **spec** |

Performs scripted canonical movement. Renderer or presentation physics never determine the resulting canonical transform.

### entity.flip

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | Yes |
| Status | **spec** |

Requires a flippable entity. A player source must also pass the applicable player guard.

### entity.set_locked

| Property | Contract |
| --- | --- |
| Allowed source | `script`; `player` only in a permitted sandbox |
| Payload | `{ entityId: EntityId; locked: boolean }` |
| Prediction default | Conditional (`maybe` in Appendix C) |
| Status | **spec** |

Sets canonical locked state and is permission-gated. Appendix C does not define which sandbox permission enables a player source.

### entity.spawn

| Property | Contract |
| --- | --- |
| Allowed source | `script` or `system`; `player` only in a permitted sandbox |
| Payload | `{ prefabId: PrefabId; transform?: CanonicalTransform; props?: CanonicalObject }` |
| Prediction default | No |
| Status | **spec** |

Creates a deterministic `EntityId` from canonical action identity plus spawn index. Optional props must remain canonical-compatible.

### entity.destroy

| Property | Contract |
| --- | --- |
| Allowed source | `script` or `system`; `player` only in a permitted sandbox |
| Payload | `{ entityId: EntityId }` |
| Prediction default | No |
| Status | **spec** |

Destroys the entity and cleans its memberships and references. Entity IDs are never reused; existing script proxies become safely invalid.

## Container, deck, and stack actions

### container.move

| Property | Contract |
| --- | --- |
| Allowed source | `script` or deterministic `internal` subcommand |
| Payload | `{ entity: EntityId; from: ContainerId; to: ContainerId; index: number }` |
| Prediction default | No |
| Status | **spec** |

Transfers an entity atomically between exclusive containers at the requested canonical index. Appendix C spells the fields `entity`, `from`, `to`, and `index`; it does not specify endpoint nullability or world encoding.

### deck.shuffle

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ deckId: DeckId }` |
| Prediction default | No |
| Status | **spec** |

Uses the canonical versioned RNG. A caller must never provide the resulting card order.

### deck.draw_to_container

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ deckId: DeckId; target: ContainerId; count: number }` |
| Prediction default | No |
| Status | **spec** |

Derives the drawn card identities from canonical deck contents and moves them to the target container. The last deck item is the top in v1. Appendix C does not state integer bounds for `count`; an insufficient request rejects the transaction.

### deck.draw_to_world

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ deckId: DeckId; transform?: CanonicalTransform }` |
| Prediction default | Cautious (`yes-ish` in Appendix C) |
| Status | **spec** |

Extracts the canonical top card into the world. Card identity comes from the deck, never from the request.

### deck.deal

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ deckId: DeckId; targets: readonly DealTarget[]; cardsEach: number }` |
| Prediction default | No |
| Status | **spec** |

Deals in round-robin order. Target array order is therefore canonical and significant; each round visits targets in array order. If the deck cannot satisfy the full deal, the transaction rejects without a partial deal. Appendix C does not further define the serialized `DealTarget` shape.

### stack.remove_top

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ stackId: StackId }` |
| Prediction default | Conditional (`maybe` in Appendix C) |
| Status | **spec** |

Removes the entity identified by the stack's canonical top; callers do not choose its identity.

## Die and counter actions

### die.roll

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | No |
| Status | **spec** |

The kernel's canonical RNG chooses the face. Animation and presentation randomness cannot choose or alter the canonical result.

### die.set_value

| Property | Contract |
| --- | --- |
| Allowed source | `script` |
| Payload | `{ entityId: EntityId; value: CanonicalValue }` |
| Prediction default | No |
| Status | **spec** |

Sets a die to a value that exactly matches one of its valid faces. This is script-only.

### counter.set

| Property | Contract |
| --- | --- |
| Allowed source | `script`; a permitted `player` interaction |
| Payload | `{ entityId: EntityId; value: number }` |
| Prediction default | Yes |
| Status | **spec** |

Sets the counter and clamps the result to any configured bounds. The registry does not define the permission model for player-originated counter interaction.

### counter.add

| Property | Contract |
| --- | --- |
| Allowed source | `script`; a permitted `player` interaction |
| Payload | `{ entityId: EntityId; amount: number }` |
| Prediction default | Yes |
| Status | **spec** |

Adds the amount and clamps the result to any configured bounds. Subtraction is represented by a negative amount; Appendix C defines no separate `counter.subtract` action.

## Interaction, text, snap, and prompt actions

### button.press

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | Yes |
| Status | **spec** |

Requires an enabled button and approval from `can_press` when that guard is present.

### text.set

| Property | Contract |
| --- | --- |
| Allowed source | `script` |
| Payload | `{ entityId: EntityId; value: string }` |
| Prediction default | No |
| Status | **spec** |

Sets canonical text. The string is bounded, although Appendix C does not specify the v1 length limit.

### snap.attach

| Property | Contract |
| --- | --- |
| Allowed source | `script` or deterministic `internal` subcommand |
| Payload | `{ snapPointId: SnapPointId; entityId: EntityId }` |
| Prediction default | No |
| Status | **spec** |

Attaches an entity only if capacity and compatibility rules permit it. Automatic snap resolution filters valid candidates, chooses the nearest, and breaks an exact distance tie by stable `SnapPointId`.

### prompt.respond

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ promptId: PromptId; response: CanonicalValue }` |
| Prediction default | Yes |
| Status | **spec** |

The prompt must target the acting player, and the response must satisfy the canonical prompt schema. The registry does not define the response's narrower per-prompt shape.

## Prediction guidance

Prediction changes latency handling, not canonical authority. A predicted action is still ordered, validated, and reconciled against the canonical stream.

| Guidance | Actions |
| --- | --- |
| Predict initially | [`entity.grab`](#entitygrab), [`entity.drop`](#entitydrop), [`entity.flip`](#entityflip), [`button.press`](#buttonpress), simple [`counter.set`](#counterset)/[`counter.add`](#counteradd) interactions, [`prompt.respond`](#promptrespond) |
| Do not predict initially | [`deck.shuffle`](#deckshuffle), [`deck.deal`](#deckdeal), [`die.roll`](#dieroll), [`entity.spawn`](#entityspawn), [`entity.destroy`](#entitydestroy), large scripted actions, timer actions such as [`system.timer_fire`](#systemtimer_fire) |
| Registry remains conditional | [`entity.set_locked`](#entityset_locked) (`maybe`), [`deck.draw_to_world`](#deckdraw_to_world) (`yes-ish`), [`stack.remove_top`](#stackremove_top) (`maybe`) |

## Derived events

Appendix C.2 lists the event vocabulary but does not provide an action-to-event emission matrix. The mapping below states the direct action association where one is defined by the registry name or key rule, and labels conditional or generated-subcommand cases. It must not be read as an invented promise that every listed action always emits every associated event.

| Derived event | Emitting action or condition |
| --- | --- |
| `game.started` | [`system.game_start`](#systemgame_start) |
| `player.joined` | [`system.player_joined`](#systemplayer_joined) |
| `player.left` | [`system.player_left`](#systemplayer_left) |
| `player.disconnected` | [`system.player_disconnected`](#systemplayer_disconnected) |
| `player.removed` | [`system.player_removed`](#systemplayer_removed) |
| `seat.assigned` | [`system.seat_assign`](#systemseat_assign) |
| `seat.left` | A seat-clearing lifecycle transition; Appendix C defines no dedicated seat-unassign action. It may be a consequence of a player departure/removal, but the exact emission matrix is unspecified. |
| `entity.spawned` | [`entity.spawn`](#entityspawn) |
| `entity.destroyed` | [`entity.destroy`](#entitydestroy) |
| `entity.grabbed` | [`entity.grab`](#entitygrab) |
| `entity.dropped` | [`entity.drop`](#entitydrop) |
| `entity.flipped` | [`entity.flip`](#entityflip) |
| `container.added` | A successful [`container.move`](#containermove), or a deck/stack operation that generates an equivalent internal transfer |
| `container.removed` | A successful [`container.move`](#containermove), or a deck/stack/destroy operation that generates an equivalent internal removal |
| `container.moved` | [`container.move`](#containermove) when the semantic transition is a move; exact added/removed/moved distinctions are unspecified |
| `deck.shuffled` | [`deck.shuffle`](#deckshuffle) |
| `deck.drawn` | [`deck.draw_to_container`](#deckdraw_to_container) or [`deck.draw_to_world`](#deckdraw_to_world) |
| `deck.dealt` | [`deck.deal`](#deckdeal) |
| `stack.created` | A placement transition such as [`entity.drop`](#entitydrop) that creates a stack; no dedicated create action exists |
| `stack.changed` | A stack-affecting placement/transfer or [`stack.remove_top`](#stackremove_top) |
| `stack.dissolved` | A stack-affecting placement/transfer or [`stack.remove_top`](#stackremove_top) that leaves no stack; exact threshold is unspecified |
| `die.rolled` | [`die.roll`](#dieroll) |
| `counter.changed` | [`counter.set`](#counterset) or [`counter.add`](#counteradd) |
| `zone.entered` | A semantic placement transition caused by [`entity.drop`](#entitydrop), [`entity.move`](#entitymove), spawn/destroy, or a generated transfer; membership is recomputed on placement transitions, not frame physics |
| `zone.left` | The corresponding semantic placement transition out of a zone; exact action matrix is unspecified |
| `snap.attached` | [`snap.attach`](#snapattach), or automatic snap resolution during [`entity.drop`](#entitydrop) |
| `snap.detached` | A placement/destruction transition that removes an attachment; Appendix C defines no `snap.detach` action |
| `button.pressed` | [`button.press`](#buttonpress) |
| `text.changed` | [`text.set`](#textset) |
| `prompt.created` | A deterministic subcommand generated by `ui:prompt`, `ui:confirm`, or `ui:number_prompt`; Appendix C defines no prompt-create action |
| `prompt.responded` | [`prompt.respond`](#promptrespond) |
| `prompt.canceled` | A prompt lifecycle transition; Appendix C defines no prompt-cancel action |
| `timer.fired` | [`system.timer_fire`](#systemtimer_fire) |
| `action.rejected` | Any ordered action rejected by semantic validation, a guard, a script error, or a failed generated subcommand |
| `script.error` | Any top-level action whose callback or subscriber execution raises a canonical script error |

## References

- [`SPEC 03.3` (ordered actions and rejection), `SPEC 03.4` (mutation boundary), and `SPEC 03.6`-`03.9`](./spec/handoff-v2.txt)
- [`SPEC 04` (Lua API v1), especially `04.4`-`04.8`](./spec/handoff-v2.txt)
- [`Appendix C` (Canonical Action Registry v1), including `C.1` and `C.2`](./spec/handoff-v2.txt)
