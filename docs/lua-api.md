---
title: Lua API v1 reference
description: The stable deterministic Lua scripting contract for Digipology tabletop rules, semantic objects, prompts, timers, and callbacks.
---

# Lua API v1 reference

> Canonical mutations produced by this API are defined in the [canonical action registry v1](./actions.md). This page renders SPEC 04 for creators; the handoff specification remains normative.

## Status and notation

| Status | Meaning |
| --- | --- |
| **kernel v0** | Implemented by `digipology-kernel` and checked against its code. |
| **spec** | Required by SPEC 04 but not yet implemented by a kernel v0 package in this repository. |
| **surface only** | SPEC 04 names the member but does not settle enough detail to document a callable contract. |

This page is the implemented creator API v1 and the manifest's single source of truth. A SPEC 04 member without a #64 registered action is omitted; an unmapped method is never permission to invent an action.

Signatures below use these documentation types:

```lua
EntityId, PlayerId, SeatId, PrefabId, TimerId, PromptId -- stable opaque IDs
Entity, Card, Deck, Hand, Container, Die, Counter,       -- semantic proxies
Zone, SnapPoint, Button, Text, Player
CanonicalValue -- nil, boolean, finite number, string, or acyclic canonical table
```

SPEC 04.5 gives a combined “methods/fields” list without classifying every member. This reference treats descriptive values (`value`, `count`, `entities`, and similar names) as fields and operation-like names as colon-call methods. That classification is a documentation interpretation, not a new API decision; implementations must resolve it before stabilization. Any parameter or return detail not fixed by SPEC 04 is called out explicitly.

## 1. Environment and philosophy

Lua is for tabletop rules: dealing cards, validating moves, scoring zones, rolling dice, reacting to buttons, and coordinating players. It does not control Babylon.js, the DOM, browser behavior, or rendering state. Canonical gameplay must never depend on presentation physics or a client-only visual effect.

Creator code is hostile input. The sandbox exposes only the documented API and has no unrestricted access to:

- arbitrary JavaScript or JS interop;
- the browser, DOM, or renderer;
- network or storage APIs;
- the filesystem or operating system.

`require()` resolves only project or platform modules packaged into the immutable release. It cannot load a machine-local file, download a module, or select code based on the host environment. Releases pin `luaApiVersion` and the deterministic convenience library separately as `luaStdlibVersion`.

## 2. Persistent `state`

The persistence rule is simple: **if a value affects future gameplay, it belongs in `state`.** The kernel owns and serializes this namespace as canonical script state.

```lua
state.turn = 1
state.round = (state.round or 0) + 1
state.scores = state.scores or { red = 0, blue = 0 }
```

Persistent values may contain only:

- `nil`;
- booleans;
- finite numbers;
- strings;
- tables made recursively from those values.

Functions, userdata, entity/player proxies, cyclic tables, and nonfinite numbers cannot persist. Do not store a callback closure or proxy for later use; store a stable ID or stable ref-backed fact and resolve it again.

The reconstruction contract is:

```text
fresh Lua VM + immutable Release code + canonical state = same gameplay behavior
```

Nothing important may survive only in VM globals, closures, module caches, renderer state, wall-clock time, or the browser. Canonical table serialization must not depend on Lua table iteration order; use APIs whose ordering is specified when order affects gameplay.

## 3. `refs`, `settings`, `props`, and `self`

### `refs`

`refs.<name>` resolves an editor-defined entity reference by stable identity. Renaming the entity or changing its display name does not break the reference.

```lua
refs.main_deck:shuffle()
refs.score:add(1)
```

A resolved value is the semantic proxy appropriate to that entity. Proxies cannot be persisted in `state`. The behavior of a missing reference is not specified by SPEC 04 and must not be assumed.

### `settings`

`settings` is the read-only canonical room-start configuration. Scripts may branch on it, but cannot change it. Values are canonical-compatible and identical for healthy simulations processing the same game.

```lua
if settings.starting_hand == 5 then
    -- deterministic rule choice
end
```

### `props`

Entity script bindings receive `props`, the editor-authored configuration for that particular binding. Use props to configure reusable scripts without identifying objects by mutable display name.

```lua
return ctx.player.seat.id == props.seat_id
```

SPEC 04 does not define whether `props` is writable during execution. Treat it as authored configuration, not persistent state; gameplay changes belong in `state`.

### `self`

Entity-bound scripts receive `self`, the proxy for their bound entity.

```lua
self:flip()
```

After its entity is destroyed, a proxy becomes invalid safely. It must not become a dangling VM or renderer reference. SPEC 04 does not prescribe the exact Lua error/return value for later access, so code should not retain proxies beyond the current callback.

## 4. Namespaces

The v1 environment exposes `state`, `refs`, `settings`, `game`, `scene`, `players`, `random`, `timer`, `ui`, and `data`, plus the separately pinned `turns` and `scores` standard-library modules. Entity bindings additionally receive `self` and `props`.

### `state`

Persistent canonical script data. See [Persistent `state`](#2-persistent-state). Reads return the reconstructed canonical value; writes are committed only if the surrounding top-level action succeeds.

### `refs`

Stable editor-authored entity references. See [`refs`, `settings`, `props`, and `self`](#3-refs-settings-props-and-self).

### `settings`

Read-only canonical room-start settings. See [`refs`, `settings`, `props`, and `self`](#3-refs-settings-props-and-self).

### `game`

| Member | Parameters | Return | Determinism and status |
| --- | --- | --- | --- |
| `game` | — | Not specified | **surface only.** SPEC 04.1 exposes the namespace but defines no v1 members. |
| `game:end(...)` | Not specified | Not specified | SPEC 10.10 says this produces shared canonical results, but SPEC 04 does not include it in the v1 callable surface or define a registry action. It is therefore not stabilized here. |

Do not infer turns, rounds, scores, or teams APIs under `game`; those belong to the separately versioned Lua standard library and are a non-goal of this reference.

### `scene`

#### `scene:get(id)`

- **Parameters:** `id: EntityId` — stable entity identity.
- **Returns:** the matching semantic entity proxy, or `nil` for a missing ID.
- **Determinism:** identity lookup is canonical; it must not consult renderer objects.

```lua
local piece = scene:get(state.active_piece_id)
```

#### `scene:find(name)`

- **Parameters:** `name: string` — authored entity name.
- **Returns:** the first matching entity proxy in ascending EntityId order, or `nil`.
- **Determinism:** duplicate names resolve by ascending stable EntityId. Prefer `refs` or stable IDs.

```lua
local board = scene:find("Board")
```

#### `scene:query(filter)`

- **Parameters:** `filter: table`; SPEC 04 shows `{ tags = { "enemy", "unit" } }` and defines no other keys.
- **Returns:** an array of matching proxies.
- **Determinism:** results use ascending stable `EntityId` order.

```lua
local enemies = scene:query({ tags = { "enemy", "unit" } })
```

`scene:spawn` and `scene:destroy` are omitted from creator API v1 because #64 did not register backing actions.

### `players`

#### `players:list()`

- **Parameters:** none.
- **Returns:** an array of `Player` proxies.
- **Determinism:** seated players use stable seat order; unseated participants follow in `PlayerId` order. This order is the basis for deterministic loops such as dealing.

```lua
for _, player in ipairs(players:list()) do
    player:message("Welcome")
end
```

#### `players:get(id)`

- **Parameters:** `id: PlayerId`.
- **Returns:** the matching `Player` proxy, or `nil`.
- **Determinism:** stable identity lookup.

```lua
local active = players:get(state.active_player_id)
```

#### `players:count()`

- **Parameters:** none.
- **Returns:** the canonical player count as an integer.
- **Determinism:** counts records in canonical `players` state.

```lua
state.started_with = players:count()
```

#### `players:by_seat(seat_id)`

- **Parameters:** `seat_id: SeatId`.
- **Returns:** the player assigned to that seat, or `nil`.
- **Determinism:** canonical seat assignment lookup.

```lua
local dealer = players:by_seat("dealer")
```

### `random`

All methods consume the versioned canonical PRNG stored in game state. They never use Lua entropy, `Math.random`, the browser, wall-clock time, or presentation randomness. A transaction that aborts discards its uncommitted RNG state along with its other gameplay mutations.

#### `random:int(min, max)`

- **Parameters:** `min: number`, `max: number`.
- **Returns:** a deterministic integer in the inclusive `[min,max]` range.
- **Determinism:** consumes canonical RNG in a replayable way.

```lua
local first_player_index = random:int(1, players:count())
```

#### `random:float()`

- **Parameters:** none.
- **Returns:** the canonical PRNG's deterministic finite value in `[0,1)`.
- **Determinism:** consumes canonical RNG; callers must not assume unstated numeric bounds.

```lua
local sample = random:float()
```

#### `random:choice(list)`

- **Parameters:** `list: table` used as an ordered array.
- **Returns:** one deterministic member, or `nil` for an empty list.
- **Determinism:** selection depends on canonical RNG and the supplied array order. Never build the list from unordered table-key iteration.

```lua
local color = random:choice({ "red", "green", "blue" })
```

#### `random:shuffle(list)`

- **Parameters:** `list: table` used as an ordered array.
- **Returns:** a new shuffled array; the input is unchanged.
- **Determinism:** consumes canonical RNG. This list utility is distinct from `Deck:shuffle()`, which queues [`deck.shuffle`](./actions.md#deckshuffle) and never accepts a caller-provided resulting order.

```lua
local initiative = { "red", "green", "blue" }
local shuffled = random:shuffle(initiative)
```

### `timer`

#### `timer:after(delay, callback_name)`

- **Parameters:** `delay: number`, shown in seconds by `timer:after(5, ...)`; `callback_name: string`.
- **Returns:** a timer ID is implied by `timer:cancel(timer_id)`, but its exact return contract is not stated.
- **Determinism:** schedules a named one-shot callback. Room service later contributes [`system.timer_fire`](./actions.md#systemtimer_fire), which fires the timer exactly once in canonical order.

```lua
local timer_id = timer:after(5, "finish_turn")
```

Callbacks must be named functions, not anonymous closures. A closure captures VM-local memory that cannot be reconstructed; a name can be resolved again from immutable Release code in a fresh VM.

#### `timer:cancel(timer_id)`

- **Parameters:** `timer_id: TimerId`.
- **Returns:** `nil`.
- **Determinism:** queues `timer.cancel`; cancellation is canonical and a later `system.timer_fire` rejects.

```lua
timer:cancel(state.pending_timer_id)
```

### `ui`

The UI namespace creates structured canonical prompts, not arbitrary DOM or custom UI. A player answers through [`prompt.respond`](./actions.md#promptrespond); the response becomes part of the ordered action stream and must target that player and satisfy the stored schema.

#### `ui:prompt(player, schema)`

- **Parameters:** `player: Player`; `schema: { id: string, title: string, choices: table, ... }`.
- **Returns:** the canonical prompt ID.
- **Behavior:** creates a choice prompt. Beyond the shown `id`, `title`, and `choices`, the schema is not defined in SPEC 04.

```lua
ui:prompt(player, {
    id = "action",
    title = "Choose",
    choices = { "trade", "pass" },
})
```

#### `ui:confirm(player, schema)`

- **Parameters:** `player: Player`; `schema: { id: string, title: string, ... }`.
- **Returns:** the canonical prompt ID.
- **Behavior:** creates a confirmation prompt whose response is boolean.

```lua
ui:confirm(player, { id = "end_turn", title = "End your turn?" })
```

#### `ui:number_prompt(player, schema)`

- **Parameters:** `player: Player`; `schema: { id: string, min: number, max: number, step: number, default: number, ... }`.
- **Returns:** the canonical prompt ID.
- **Behavior:** creates a numeric prompt with inclusive endpoints and exact `min + n * step` validation.

```lua
ui:number_prompt(player, {
    id = "bid",
    min = 0,
    max = 10,
    step = 1,
    default = 3,
})
```

Prompt state is canonical. Prompt creation is a deterministic generated subcommand (Appendix C has no create action); response is `prompt.respond`. The game callback list includes `on_prompt`, but SPEC 04 does not define its context schema or dispatch timing beyond the canonical response flow.

### `turns`

Deterministic turn convenience state stored under canonical `state`; this is Lua stdlib v1, not a kernel primitive.

#### `turns:start(first?)`

Starts the stable seat-order/player-ID order, optionally at a supplied player, and returns the current player.

#### `turns:current()`

Returns the current player or `nil` when stopped.

#### `turns:next()`

Advances cyclically and returns the next player.

#### `turns:index()`

Returns the current one-based turn index, or zero before start.

#### `turns:is_current(player)`

Tests a player proxy or PlayerId against the current turn.

#### `turns:stop()`

Stops turn progression without discarding the stored order.

### `scores`

Deterministic finite score convenience state stored under canonical `state`; ties use stable player ordering.

#### `scores:set(subject, value)`

Sets and returns a subject's score.

#### `scores:add(subject, amount)`

Adds to and returns a subject's score.

#### `scores:get(subject)`

Returns a subject's score, defaulting to zero.

#### `scores:leader()`

Returns the highest-scoring player; stable player order breaks ties.

### `data`

| Member | Parameters | Return | Determinism and status |
| --- | --- | --- | --- |
| `data` | — | Not specified | **surface only.** SPEC 04.1 exposes packaged release data but defines no v1 lookup members. Data must come from the immutable packaged Release, never network or filesystem access. |

Do not assume a loader, path syntax, mutability model, or iteration order until the v1 member surface is specified.

## 5. Semantic proxies

Proxy operations expose tabletop meaning, never renderer objects. Read operations do not queue canonical actions. Every mutating method below maps to one registered kernel action; methods without #64 backing are omitted.

### Card

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `is_face_up` | Field: `boolean` | Current canonical face orientation. | None; read only. |
| `flip` | `card:flip()` | Toggles face orientation; requires the entity to be flippable and a player guard when player-originated. | [`entity.flip`](./actions.md#entityflip) |
| `set_face_up` | `card:set_face_up(value: boolean)` | Queues a flip only when the requested orientation differs. | [`entity.flip`](./actions.md#entityflip) |
| `definition_id` | Field: stable definition ID (serialized type unspecified) | Identifies the authored card definition. | None; read only. |
| `definition` | Field: packaged card definition (shape unspecified) | Reads immutable definition data. | None; read only. |

```lua
if not self.is_face_up then self:flip() end
```

### Deck

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `count` | Field: integer | Number of cards currently in the deck. The last item is top in v1. | None; read only. |
| `shuffle` | `deck:shuffle()` | Reorders with canonical RNG; caller never supplies the result. | [`deck.shuffle`](./actions.md#deckshuffle) |
| `draw_to` | `deck:draw_to(target: Container, count?: number)` | Draws canonical top card identity/identities to a container. Optionality/default for `count` is not stated by SPEC 04. | [`deck.draw_to_container`](./actions.md#deckdraw_to_container) |
`draw_to_world`, `deal`, `insert_top`, and `insert_bottom` are omitted because #64 provides no exact backing action for those signatures.

### Hand

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `count` | Field: integer | Number of contained entities visible through this proxy. | None; read only. |
| `list` | `hand:list()` | Returns contained proxies in ascending stable EntityId order. | None; read only. |
| `add` | `hand:add(entity: Entity, index?: number)` | Transfers an entity into the hand. Default index is unspecified. | [`container.move`](./actions.md#containermove) |
| `remove` | `hand:remove(entity: Entity)` | Removes an entity from the hand. The registry's world/no-container encoding is unspecified. | [`container.move`](./actions.md#containermove) |
| `contains` | `hand:contains(entity: Entity)` → `boolean` | Tests canonical membership. | None; read only. |

```lua
if not player.hand:contains(card) then player.hand:add(card) end
```

### Container

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `count` | Field: integer | Number of contained entities. | None; read only. |
| `list` | `container:list()` | Returns proxies in ascending stable EntityId order. | None; read only. |
| `contains` | `container:contains(entity: Entity)` → `boolean` | Tests the single canonical source of membership. | None; read only. |
| `add` | `container:add(entity: Entity, index?: number)` | Atomically transfers an entity into this container. Default index is unspecified. | [`container.move`](./actions.md#containermove) |
| `remove` | `container:remove(entity: Entity)` | Atomically removes an entity; destination/world encoding is unspecified. | [`container.move`](./actions.md#containermove) |
| `move_to` | `container:move_to(entity: Entity, target: Container, index?: number)` | Atomically transfers an entity from this container to the target. | [`container.move`](./actions.md#containermove) |

```lua
refs.discard:move_to(card, refs.main_deck)
```

### Die

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `roll` | `die:roll()` | Uses kernel RNG to choose a valid face; animation cannot choose the result. | [`die.roll`](./actions.md#dieroll) |
| `value` | Field: canonical face value | Current canonical face value. | None; read only. |
| `faces` | Field: ordered table of canonical face values | Authored valid faces. Their order participates in deterministic selection. | None; read only. |

```lua
refs.attack_die:roll()
```

### Counter

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `value` | Field: finite number | Current canonical value. | None; read only. |
| `set` | `counter:set(value: number)` | Sets and clamps to configured bounds. | [`counter.set`](./actions.md#counterset) |
| `add` | `counter:add(amount: number)` | Adds and clamps to configured bounds. | [`counter.add`](./actions.md#counteradd) |
| `subtract` | `counter:subtract(amount: number)` | Subtracts and clamps; represented as a negative add because Appendix C has no subtract action. | [`counter.add`](./actions.md#counteradd) |
| `reset` | `counter:reset()` | Restores the canonical component default. | [`counter.set`](./actions.md#counterset) |

```lua
refs.score:add(1)
```

### Zone

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `contains` | `zone:contains(entity: Entity)` → `boolean` | Tests canonical zone membership. Membership is recomputed on semantic placement transitions, not frame physics. | None; read only. |
| `entities` | Field: ordered table of entity proxies | Current members in ascending stable EntityId order. | None; read only. |

```lua
if refs.scoring_zone:contains(self) then refs.score:add(1) end
```

### SnapPoint

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `is_occupied` | Field: `boolean` | Whether canonical capacity is occupied. | None; read only. |
| `entities` | Field: ordered table of entity proxies | Entities currently attached in ascending stable EntityId order. | None; read only. |
| `attach` | `snap_point:attach(entity: Entity)` | Attaches if capacity and compatibility allow. | [`snap.attach`](./actions.md#snapattach) |

Automatic placement filters compatible candidates, chooses the nearest, and breaks an exact distance tie by stable `SnapPointId`.

```lua
if not refs.slot.is_occupied then refs.slot:attach(self) end
```

### Button

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `is_enabled` | Field: `boolean` | Current canonical enabled state. | None; read only. |

Player presses are represented by [`button.press`](./actions.md#buttonpress), require an enabled button, and run `can_press`. SPEC 04.5 does not list a `Button:press()` script method.

`set_enabled` and `set_label` are omitted because #64 registered no backing mutation.

### Text

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `get` | `text:get()` → `string` | Reads the canonical text value. | None; read only. |
| `set` | `text:set(value: string)` | Sets a bounded canonical string; the v1 size limit is unspecified. | [`text.set`](./actions.md#textset) |

```lua
refs.status:set("Round " .. state.round)
```

### Player

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `id` | Field: `PlayerId` | Stable logical participant identity; reconnect keeps the same ID. | None; read only. |
| `name` | Field: `string` | Player-facing name. | None; read only. |
| `seat` | Field: seat proxy/value or `nil` (shape unspecified) | Canonical seat assignment. SPEC 04.9 demonstrates `player.seat.id`. | None; read only. |
| `hand` | Field: `Hand` or `nil` | The player's semantic hand when configured. | None; read only. |

```lua
if player.hand then refs.main_deck:draw_to(player.hand, 1) end
```

## 6. Timers and prompts

Timers and prompts cross VM and network boundaries, so their reconstructable identity is part of the contract.

For a timer, schedule a named callback:

```lua
function finish_turn(ctx)
    state.turn = state.turn + 1
end

state.finish_timer_id = timer:after(5, "finish_turn")
```

Do not pass an anonymous closure. A new VM can load `finish_turn` from immutable Release code, while it cannot recreate arbitrary captured closure state. Store any future-relevant data in `state`, not in locals captured at scheduling time. Room service eventually sequences `system.timer_fire`; the callback executes inside that action's atomic transaction.

For a prompt, the flow is:

```text
Lua ui method → canonical prompt state → targeted player response
              → prompt.respond OrderedAction → validation → on_prompt processing
```

The prompt remains canonical while open. A response consumes a sequence even if rejected. A successful response must come from the target player and match the stored prompt schema. If response processing or its script callback fails, the whole response transaction aborts. SPEC 04 does not define prompt ID construction, duplicate authored `id` handling, cancellation API, exact response values, or the `on_prompt(ctx)` shape.

## 7. Callbacks and guards

### Game callbacks

| Callback | Trigger contract |
| --- | --- |
| `on_start(ctx)` | Canonical game initialization. |
| `on_player_join(ctx)` | A player lifecycle join. |
| `on_prompt(ctx)` | Canonical prompt processing; exact context schema is unspecified. |

### Entity callbacks

| Callback | Trigger contract |
| --- | --- |
| `on_grab(ctx)` | The bound entity is successfully grabbed. |
| `on_drop(ctx)` | The bound entity is successfully dropped. |
| `on_flip(ctx)` | The bound entity is successfully flipped. |
| `on_roll(ctx)` | The bound die is rolled. |
| `on_press(ctx)` | The bound button is pressed. |
| `on_enter(ctx)` | An entity enters the bound zone. |
| `on_leave(ctx)` | An entity leaves the bound zone. |
| `on_container_add(ctx)` | An entity is added to the bound container. |
| `on_container_remove(ctx)` | An entity is removed from the bound container. |

SPEC 04 lists callback names but does not define a complete `ctx` schema. Its examples establish `ctx.player`, `ctx.player.seat.id`, and, in SPEC 10.13, `ctx.object`. Do not assume additional keys without a versioned contract.

### Guards

The shipped v1 guard list, limited to #64 hook points, is:

- `can_grab(ctx)`
- `can_drop(ctx)`
- `can_flip(ctx)`
- `can_press(ctx)`

Guards are read-only. They return allow/deny and may also return a user-facing reason string. They cannot mutate `state`, consume canonical randomness, schedule timers/prompts, or queue any canonical mutation. A denial rejects the attempted action without changing gameplay state, but the ordered action still consumes its sequence.

```lua
function can_grab(ctx)
    return ctx.player.seat.id == props.seat_id,
        "Only this seat may move this piece."
end
```

Here the boolean allows the matching seat and denies every other seat; the second return value explains a denial to the player. The guard only reads canonical context and binding props.

### Subscriber and subcommand order

When an event has multiple script subscribers, they execute in deterministic ascending/stable `ScriptBindingId` order. Normal callbacks may queue deterministic subcommands; those subcommands execute FIFO inside the parent transaction. Both rules are observable and gameplay-significant. Never rely on filesystem order, Lua table-key order, editor display order, or renderer traversal order.

If any subscriber or queued subcommand fails, the parent top-level transaction aborts, including earlier uncommitted callback changes.

## 8. Failure and budgets

A canonical script error records:

- script;
- binding;
- function;
- line;
- message;
- `Sequence`.

The creator sees where the failure occurred and which ordered action triggered it. The error aborts the entire top-level transaction, so a callback cannot leave a shuffle, score change, spawn, or container transfer half applied. The rejected action still consumes its sequence.

The runtime bounds instructions/operations, recursion, memory growth, generated command count, and persistent state size. Infinite loops and command explosions therefore fail in a controlled way. A wall-clock timeout is not sufficient as the only guardrail because machine speed and scheduling are not deterministic; SPEC 04 requires a viable instruction/operation budget strategy. Exact v1 numeric limits are not yet specified.

## 9. Worked examples

### Game start and deterministic deal

This is the SPEC 04.9 startup example:

```lua
function on_start(ctx)
    state.turn = 1
    refs.main_deck:shuffle()
    for _, player in ipairs(players:list()) do
        if player.hand then refs.main_deck:draw_to(player.hand, 1) end
    end
end
```

| Line | Meaning |
| --- | --- |
| `function on_start(ctx)` | Runs during [`system.game_start`](./actions.md#systemgame_start). The entire callback is inside that transaction. |
| `state.turn = 1` | Persists a canonical finite number; it survives VM reconstruction. |
| `refs.main_deck:shuffle()` | Resolves a stable reference and queues [`deck.shuffle`](./actions.md#deckshuffle), using canonical RNG rather than client entropy. |
| `players:list()` | Returns players in stable seat order, followed by unseated `PlayerId` order. |
| `ipairs(...)` | Walks the returned array order, not unordered table keys. This makes recipient iteration deterministic. |
| `if player.hand then ...` | Skips players without a configured semantic hand. |
| `draw_to(player.hand, 1)` | Draws one canonical top card per player through the registered `deck.draw_to_container` action. Insufficient cards reject the enclosing top-level transaction. |
| `end` | If any queued operation or callback fails, the game-start transaction discards all uncommitted changes. |

### Read-only grab guard

This is the SPEC 04.9 guard example:

```lua
function can_grab(ctx)
    return ctx.player.seat.id == props.seat_id,
        "Only this seat may move this piece."
end
```

| Line | Meaning |
| --- | --- |
| `function can_grab(ctx)` | Runs before a player [`entity.grab`](./actions.md#entitygrab) is allowed. |
| `ctx.player.seat.id` | Reads the acting player's canonical seat identity. |
| `props.seat_id` | Reads the editor-authored per-binding configuration. |
| `return condition, reason` | Returns allow/deny plus an optional player-facing explanation. It queues no mutation. |

### Zone scoring

This representative callback comes from SPEC 10.13:

```lua
function on_enter(ctx)
    refs.score:add(1)
end
```

| Line | Meaning |
| --- | --- |
| `function on_enter(ctx)` | Runs when a semantic placement transition causes an object to enter the bound zone; frame-by-frame physics does not drive canonical membership. |
| `refs.score:add(1)` | Resolves the stable counter reference and queues [`counter.add`](./actions.md#counteradd), clamped to configured bounds. |
| `end` | The score mutation is a FIFO subcommand in the parent placement transaction. If it or another subscriber fails, the score change is discarded. |

## References

- [`SPEC 04.1`-`04.9` (Lua API v1)](./spec/handoff-v2.txt)
- [`SPEC 03.3` (rejection and atomicity), `03.6` (tabletop invariants), and `03.9` (Lua and timers)](./spec/handoff-v2.txt)
- [`SPEC 10.13` (representative creator code)](./spec/handoff-v2.txt)
- [`Appendix C`, `C.1`, and `C.2` (canonical actions, prediction, and derived events)](./spec/handoff-v2.txt)
- [`PRD-PROMPT-001`/`002`, `ARCH-013`/`014`, and Appendix H `RISK-014`](./spec/handoff-v2.txt)
