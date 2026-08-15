---
title: Canonical action registry v1
description: The canonical v1 action vocabulary, payloads, prediction guidance, and derived events for deterministic Digipology games.
---

# Canonical action registry v1

> Lua creator methods that produce these actions are documented in the [Lua API v1 reference](./lua-api.md). This page is the creator- and implementer-facing rendering of Appendix C, not a replacement for the normative specification.

## Rejection and transaction semantics

Every service-accepted ordered action consumes one monotonically increasing `Sequence`, including an action that the game rejects. A game-semantic rejection advances the processed sequence but leaves gameplay fields unchanged. Processing a top-level action is atomic: if its validation, a script callback, or any generated subcommand fails, the kernel discards every uncommitted gameplay mutation from that transaction.

Canonical state changes only through a registered action or a deterministic subcommand generated during the current transaction. Kernel v1 validates `player`, `script`, and `system` sources independently of whether the official UI exposes the operation; Lua-generated subcommands use the `script` source.

## Status legend

| Status | Meaning |
| --- | --- |
| **implemented (kernel v1, pre-wave 9)** | Registered before wave 9 and present in the `kernelVersion: 1` registry. |
| **implemented (kernel v1, #64 / PR #72)** | Registered by the tabletop-semantics wave and present in the `kernelVersion: 1` registry. |
| **implemented (kernel v1, #65 / PR #74)** | Registered by the creator-API wave and present in the `kernelVersion: 1` registry. |
| **spec** | Defined by Appendix C but not registered by kernel v1. |

Appendix C contains 28 top-level registry rows. Kernel v1 implements 21 of those rows (7 remain **spec**) and also registers four additional stack commands (`stack.create`, `stack.add`, `stack.merge`, `stack.dissolve`) plus the prompt/timer lifecycle commands (`prompt.create`, `prompt.cancel`, `timer.register`, `timer.cancel`) described by Appendix B.2 and SPEC 03.9 — 29 registered action types in `builtInActions`. Status is therefore recorded row by row rather than inferred from the normative count.

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
type Vector3 = { x: number; y: number; z: number };
type Quaternion = { x: number; y: number; z: number; w: number };
type CanonicalTransform = {
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
};
type DealTarget = PlayerId | ContainerId;
```

Every implemented action rejects unknown top-level payload keys. This `onlyKeys` discipline is part of kernel v1, so optionality below is explicit. Implemented transforms require finite position/scale coordinates within ±1,000,000, positive scales, and a finite nonzero quaternion normalized within 0.001; the committed transform is normalized and quantized to a 0.0001 grid. Appendix C still leaves the nested deal-target and unimplemented spawn-props contracts open.

## System actions

### system.game_start

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ settings?: Record<string, boolean | finite number | string> }` |
| Prediction default | No |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires sequence zero. When present, `settings` replaces canonical room-start settings; nested values are not accepted. The action emits `game.started`, which invokes `on_start` through the creator runtime.

### system.player_joined

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ playerId: PlayerId; name?: string }` |
| Prediction default | No |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires a non-empty, previously unused `playerId`. It stores the optional name and emits `player.joined`.

### system.player_left

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ playerId: PlayerId }` |
| Prediction default | No |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires an existing player. In ascending EntityId order it releases objects held by that player, then clears occupied seats in ascending SeatId order, deletes the player, and emits `entity.dropped`, `seat.left`, and `player.left` as applicable.

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
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires non-empty IDs and an existing player. A previously absent seat is created; an existing seat's `playerId` is replaced. The action emits `seat.assigned`.

### system.timer_fire

| Property | Contract |
| --- | --- |
| Allowed source | `system` |
| Payload | `{ timerId: TimerId }` |
| Prediction default | No |
| Status | **implemented (kernel v1, #65 / PR #74)** |

Requires an existing timer whose status is `scheduled`; a duplicate fire or fire after cancellation rejects. It marks the timer `fired` before emitting `timer.fired` with the stored callback and binding identity. Room service schedules delivery, while the kernel performs the deterministic simulation when this canonical action enters the ordered stream.

## Entity actions

### entity.grab

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | Yes |
| Status | **implemented (kernel v1, pre-wave 9)** |

The entity must have an enabled `grabbable` component, be unheld and unlocked, and either be outside a stack or be its canonical top. The acting player's `can_grab` guards run before commit. Continuous drag transforms are transient; the grab itself is canonical.

### entity.drop

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ entityId: EntityId; transform: CanonicalTransform }` |
| Prediction default | Yes |
| Status | **implemented (kernel v1, pre-wave 9)** |

The actor must hold the entity, and only a canonical stack top may leave its stack. After `can_drop`, the kernel detaches the old exclusive placement, canonicalizes the transform, and applies fixed resolution precedence: nearest compatible snap point (distance ties by SnapPointId), otherwise an exact-position stack target (EntityId order), then zone recomputation, otherwise world placement. Zones are overlays and are recomputed even after snap or stack placement.

### entity.move

| Property | Contract |
| --- | --- |
| Allowed source | `script` or `system` |
| Payload | `{ entityId: EntityId; transform: CanonicalTransform }` |
| Prediction default | No |
| Status | **implemented (kernel v1, #64 / PR #72)** |

Requires an existing `transform` component and permits only a canonical stack top to move. It removes the entity from any container, snap point, or stack, commits the canonicalized transform, and recomputes zones. It does not run automatic snap or stack resolution. Renderer or presentation physics never determine the result.

### entity.flip

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | Yes |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires a `flippable` component and toggles its canonical `flipped` value. Player sources also run `can_flip`; script sources do not.

### entity.set_locked

| Property | Contract |
| --- | --- |
| Allowed source | `script`; `player` only in a permitted sandbox |
| Payload | `{ entityId: EntityId; locked: boolean }` |
| Prediction default | Conditional (`maybe` in Appendix C) |
| Status | **implemented (kernel v1, #64 / PR #72)** |

Requires a `lockable` component. Script sources may set it directly; a player source is accepted only when canonical `settings.sandbox` is `true`. A locked grabbable is rejected by `entity.grab`.

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
| Allowed source | `script` |
| Payload | `{ entity: EntityId; from: ContainerId | null; to: ContainerId | null; index: number }` |
| Prediction default | No |
| Status | **implemented (kernel v1, #64 / PR #72)** |

Transfers an entity atomically between containers or between a container and the world while enforcing exclusive placement. `null` encodes the world for either endpoint; `from` and `to` must differ. `index` is a non-negative safe integer and is a zero-based insertion index for a target container. A world destination requires index `0`. The source must match current membership, the target must exist and have capacity, and the insertion index may not exceed its length. Success emits `container.moved` and recomputes zone membership.

### deck.shuffle

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ deckId: DeckId }` |
| Prediction default | No |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires an entity with enabled `deck` and `container` components. It replaces container order with a canonical RNG shuffle and emits `deck.shuffled`; a caller never provides the resulting card order.

### deck.draw_to_container

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ deckId: DeckId; target: ContainerId; count: number }` |
| Prediction default | No |
| Status | **implemented (kernel v1, pre-wave 9)** |

`count` must be a positive safe integer. The deck and target must differ, both must be valid containers, and the complete draw must fit the target and available cards. The last deck item is canonical top; each drawn card is appended to the target. The action emits one `deck.drawn` event containing the ordered drawn IDs. Any insufficiency rejects without a partial draw.

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
| Status | **implemented (kernel v1, #64 / PR #72)** |

Requires a non-empty existing stack. It removes the last item, recomputes that entity's zone membership, and emits `stack.changed`; removing the final item deletes the record and emits `stack.dissolved`. Callers do not choose the removed identity.

### Stack subcommand surface (Appendix B.2)

These additional exact-key, script-source commands are registered in kernel v1 by #64 / PR #72. They are kernel commands, not methods on a shipped Lua `Stack` proxy.

| Action | Payload | Validation and result | Status |
| --- | --- | --- | --- |
| `stack.create` | `{ stackId: StackId; items: EntityId[] }` | Requires a new non-empty ID and at least two unique, enabled, stackable entities currently in the world. Array order is bottom-to-top. Emits `stack.created`. | **implemented (kernel v1, #64 / PR #72)** |
| `stack.add` | `{ stackId: StackId; entityId: EntityId }` | Requires an existing stack and an enabled stackable entity currently in the world. Appends the entity as top and emits `stack.changed`. | **implemented (kernel v1, #64 / PR #72)** |
| `stack.merge` | `{ targetStackId: StackId; sourceStackId: StackId }` | Requires two distinct existing stacks. Appends the source order to the target, deletes the source, then emits target `stack.changed` and source `stack.dissolved`. | **implemented (kernel v1, #64 / PR #72)** |
| `stack.dissolve` | `{ stackId: StackId }` | Requires an existing stack, deletes it without deleting its entities, recomputes their zones, and emits `stack.dissolved`. | **implemented (kernel v1, #64 / PR #72)** |

Automatic `entity.drop` uses `stack_<actionId>` (with the first unused numeric suffix on collision) when it creates a new two-item stack. Exact-position candidates are checked in ascending EntityId order, and an existing stack is eligible only through its canonical top.

## Die and counter actions

### die.roll

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | No |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires a die with a non-empty ordered list of finite-number/string faces; `standard_d6` falls back to `1..6`. A die held by another player rejects. The canonical RNG chooses an array index and the action emits `die.rolled`; animation cannot choose or alter the result.

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
| Allowed source | `player` or `script` |
| Payload | `{ entityId: EntityId; value: number }` |
| Prediction default | Yes |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires a finite value and a `counter` component. It clamps to configured nullable min/max bounds, normalizes negative zero to zero, and emits `counter.changed`.

### counter.add

| Property | Contract |
| --- | --- |
| Allowed source | `player` or `script` |
| Payload | `{ entityId: EntityId; amount: number }` |
| Prediction default | Yes |
| Status | **implemented (kernel v1, pre-wave 9)** |

Requires a finite amount, a `counter` component, and a finite pre-clamp sum. It clamps and emits `counter.changed`. Subtraction is represented by a negative amount; there is no `counter.subtract` action.

## Interaction, text, snap, and prompt actions

### button.press

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ entityId: EntityId }` |
| Prediction default | Yes |
| Status | **implemented (kernel v1, #64 / PR #72)** |

Requires an enabled `button` component and approval from all bound `can_press` guards. Success emits `button.pressed` with the entity and acting player IDs; pressing does not itself mutate the button.

### text.set

| Property | Contract |
| --- | --- |
| Allowed source | `script` |
| Payload | `{ entityId: EntityId; value: string }` |
| Prediction default | No |
| Status | **implemented (kernel v1, #64 / PR #72)** |

Requires a `text` component and a value no larger than 4,096 UTF-8 bytes. Success stores the exact string and emits `text.changed`.

### snap.attach

| Property | Contract |
| --- | --- |
| Allowed source | `script` |
| Payload | `{ snapPointId: SnapPointId; entityId: EntityId }` |
| Prediction default | No |
| Status | **implemented (kernel v1, #64 / PR #72)** |

The IDs must differ and identify an existing snap point and entity. The entity may not already be attached there; only a stack top can leave a stack; capacity must remain and at least one required snap tag must match when the snap point has tags. Success detaches any old exclusive placement, inserts the attachment in EntityId order, emits `snap.attached` (plus the old-placement event), and recomputes zones.

### prompt.respond

| Property | Contract |
| --- | --- |
| Allowed source | `player` |
| Payload | `{ promptId: PromptId; response: CanonicalValue }` |
| Prediction default | Yes |
| Status | **implemented (kernel v1, #65 / PR #74)** |

The prompt must exist, be open, and target the acting player. Choice responses must be canonically equal to a stored choice, confirmation responses must be boolean, and number responses must be finite, inside inclusive min/max, and satisfy integer `(response - min) / step`. Success marks the prompt `resolved`, stores the response, and emits `prompt.responded`; a duplicate response rejects.

### prompt.create and prompt.cancel

| Action | Allowed source | Payload | Validation and result | Status |
| --- | --- | --- | --- | --- |
| `prompt.create` | `script` | `{ id; kind; playerId; title; choices?; min?; max?; step?; default? }` | Requires a new non-empty ID, an existing player, and kind `choice`, `confirm`, or `number`. Choice prompts require a non-empty canonical choices array and an optional default equal to one choice. Number prompts require finite `min <= max`, positive finite `step`, and a valid optional default. Confirm defaults are boolean. Emits `prompt.created`. | **implemented (kernel v1, #65 / PR #74)** |
| `prompt.cancel` | `script` or `system` | `{ promptId: PromptId }` | Requires an open existing prompt, marks it `canceled`, and emits `prompt.canceled`. | **implemented (kernel v1, #65 / PR #74)** |

Creators call [`ui:prompt`, `ui:confirm`, or `ui:number_prompt`](./lua-api.md#ui) rather than constructing `prompt.create` directly.

### timer.register and timer.cancel

| Action | Allowed source | Payload | Validation and result | Status |
| --- | --- | --- | --- | --- |
| `timer.register` | `script` | `{ timerId; delay; callback; scriptId; bindingId; entityId? }` | Requires a new non-empty timer ID, positive finite delay, and non-empty callback/script/binding IDs. Stores a `scheduled` one-shot timer and emits `timer.registered`. | **implemented (kernel v1, #65 / PR #74)** |
| `timer.cancel` | `script` | `{ timerId: TimerId }` | Requires a scheduled timer, marks it `canceled`, and emits `timer.canceled`. | **implemented (kernel v1, #65 / PR #74)** |

The room service schedules the due time but does not simulate the callback. It sequences exactly one `system.timer_fire`; the kernel rejects duplicate or canceled delivery and routes `timer.fired` back to the stored named callback.

## Prediction guidance

Prediction changes latency handling, not canonical authority. A predicted action is still ordered, validated, and reconciled against the canonical stream.

| Guidance | Actions |
| --- | --- |
| Predict initially | [`entity.grab`](#entitygrab), [`entity.drop`](#entitydrop), [`entity.flip`](#entityflip), [`button.press`](#buttonpress), simple [`counter.set`](#counterset)/[`counter.add`](#counteradd) interactions, [`prompt.respond`](#promptrespond) |
| Do not predict initially | [`deck.shuffle`](#deckshuffle), [`deck.deal`](#deckdeal), [`die.roll`](#dieroll), [`entity.spawn`](#entityspawn), [`entity.destroy`](#entitydestroy), large scripted actions, timer actions such as [`system.timer_fire`](#systemtimer_fire) |
| Registry remains conditional | [`entity.set_locked`](#entityset_locked) (`maybe`), [`deck.draw_to_world`](#deckdraw_to_world) (`yes-ish`), [`stack.remove_top`](#stackremove_top) (`maybe`) |

## Derived events

The table below is the kernel v1 emission matrix from `ctx.emit`, not an inference from event names. Events produced while processing script subcommands retain the parent action's sequence and action ID.

| Implemented event | Emitting action or condition |
| --- | --- |
| `game.started` | `system.game_start` |
| `player.joined` | `system.player_joined` |
| `player.left` | `system.player_left` |
| `seat.assigned` | `system.seat_assign` |
| `seat.left` | `system.player_left` for each cleared seat, in SeatId order |
| `entity.grabbed` | `entity.grab` |
| `entity.dropped` | `entity.drop`, or `system.player_left` when releasing a held entity |
| `entity.flipped` | `entity.flip` |
| `container.removed` | A drop, scripted move, or snap attach that first detaches an entity from a container |
| `container.moved` | `container.move`, with nullable `from`/`to`, requested `index`, and actual `fromIndex` |
| `deck.shuffled` | `deck.shuffle` |
| `deck.drawn` | `deck.draw_to_container`, with the drawn IDs in draw order |
| `stack.created` | `stack.create` or an `entity.drop` that creates a stack |
| `stack.changed` | `stack.add`, `stack.remove_top` when items remain, `stack.merge` for the target, an automatic stack addition, or removal from a stack |
| `stack.dissolved` | `stack.dissolve`, a merge source, or removal of the last stack item |
| `die.rolled` | `die.roll` |
| `counter.changed` | `counter.set` or `counter.add` |
| `zone.entered` / `zone.left` | Zone recomputation after implemented placement transitions; zones and affected entities are processed in ascending IDs |
| `snap.attached` | `snap.attach` or automatic snap resolution during `entity.drop` |
| `snap.detached` | A drop, scripted move, or snap attach that first detaches an existing attachment |
| `button.pressed` | `button.press` |
| `text.changed` | `text.set` |
| `prompt.created` | `prompt.create` |
| `prompt.responded` | `prompt.respond` |
| `prompt.canceled` | `prompt.cancel` |
| `timer.registered` | `timer.register` |
| `timer.canceled` | `timer.cancel` |
| `timer.fired` | `system.timer_fire` |

`action.rejected` is produced by the transaction runner, not `ctx.emit`. A Lua failure also appends `script.error` with script ID, binding ID, function, optional line, message, error kind, and sequence. Both leave gameplay state at its pre-action value while advancing sequence.

The following Appendix C.2 names remain **spec** because kernel v1 has no registered action or emission path for them: `player.disconnected`, `player.removed`, `entity.spawned`, `entity.destroyed`, `container.added`, and `deck.dealt`. `deck.drawn` currently comes only from `deck.draw_to_container`; the spec-only `deck.draw_to_world` does not create an implementation claim.

## References

- [`SPEC 03.3` (ordered actions and rejection), `SPEC 03.4` (mutation boundary), and `SPEC 03.6`-`03.9`](./spec/handoff-v2.txt)
- [`SPEC 04` (Lua API v1), especially `04.4`-`04.8`](./spec/handoff-v2.txt)
- [`Appendix C` (Canonical Action Registry v1), including `C.1` and `C.2`](./spec/handoff-v2.txt)
