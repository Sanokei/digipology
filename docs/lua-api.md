---
title: Lua API v1 reference
description: The stable deterministic Lua scripting contract for Digipology tabletop rules, semantic objects, prompts, timers, and callbacks.
---

# Lua API v1 reference

> Canonical mutations produced by this API are defined in the [canonical action registry v1](./actions.md). This page renders SPEC 04 for creators; the handoff specification remains normative.

## Status and notation

| Status | Meaning |
| --- | --- |
| **implemented (kernel v1, #65 / PR #74)** | Shipped in `luaApiVersion: 1` against the `kernelVersion: 1` action registry. |
| **spec** | Required by SPEC 04 but not callable through the shipped creator runtime. |
| **surface only (spec)** | Named by SPEC 04, but shipped with no callable v1 members. |

This page is the implemented creator API v1 and the editor manifest's single source of truth. Every implemented proxy mutation below appears in `PROXY_ACTIONS`; prompt and timer methods queue their registered lifecycle actions. A SPEC 04 member without a shipped #65 binding remains **spec** or is omitted; an unmapped method is never permission to invent an action.

Signatures below use these documentation types:

```lua
EntityId, PlayerId, SeatId, PrefabId, TimerId, PromptId -- stable opaque IDs
Entity, Card, Deck, Hand, Container, Die, Counter,       -- semantic proxies
Zone, SnapPoint, Button, Text, Player
CanonicalValue -- nil, boolean, finite number, string, or acyclic canonical table
```

Collection ordering, defaults, return values, proxy fields, and validation rules below are implementation facts from #65 rather than recommendations. Values exposed by a proxy are snapshots for the current callback; queued mutations become visible to later event deliveries after their commands apply.

## 1. Environment and philosophy

Lua is for tabletop rules: dealing cards, validating moves, scoring zones, rolling dice, reacting to buttons, and coordinating players. It does not control Babylon.js, the DOM, browser behavior, or rendering state. Canonical gameplay must never depend on presentation physics or a client-only visual effect.

Creator code is hostile input. The sandbox exposes only the documented API and has no unrestricted access to:

- arbitrary JavaScript or JS interop;
- the browser, DOM, or renderer;
- network or storage APIs;
- the filesystem or operating system.

The shipped v1 sandbox does not expose `require`, `package`, `io`, `debug`, browser globals, or JS interop. It exposes restricted base/string/table/math/utf8 functions; `math.random` and `math.randomseed` are removed, and `os.time()`/`os.clock()` return `0`. Releases pin `luaApiVersion` and the deterministic convenience library separately as `luaStdlibVersion`.

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

### Stable `refs`

`refs.<name>` resolves an editor-defined entity reference by stable identity. Renaming the entity or changing its display name does not break the reference.

```lua
refs.main_deck:shuffle()
refs.score:add(1)
```

A resolved value is the semantic proxy appropriate to that entity. Missing reference names evaluate to `nil`. Proxies cannot be persisted in `state`.

### Read-only `settings`

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

`props` is recursively read-only. Assignment raises `read-only value`; gameplay changes belong in `state`.

### `self`

Entity-bound scripts receive `self`, the proxy for their bound entity.

```lua
self:flip()
```

Proxies are reconstructed for each callback and cannot be persisted in `state`. `scene:get` returns `nil` when an ID is absent; entity destroy is not exposed by creator API v1.

## 4. Namespaces

The v1 environment exposes `state`, `refs`, `settings`, `game`, `scene`, `players`, `random`, `timer`, `ui`, and `data`, plus the separately pinned `turns` and `scores` standard-library modules. Entity bindings additionally receive `self` and `props`.

### `state`

Persistent canonical script data; **implemented (kernel v1, #65 / PR #74)**. See [Persistent `state`](#2-persistent-state). Reads return the reconstructed canonical value; writes are committed only if the surrounding top-level action succeeds.

### `refs`

Stable editor-authored entity references; **implemented (kernel v1, #65 / PR #74)**. Missing names evaluate to `nil`. See [`refs`, `settings`, `props`, and `self`](#3-refs-settings-props-and-self).

### `settings`

Read-only canonical room-start settings; **implemented (kernel v1, #65 / PR #74)**. See [`refs`, `settings`, `props`, and `self`](#3-refs-settings-props-and-self).

### `game`

An empty namespace reserved by SPEC 04; **surface only (spec)** in creator API v1.

| Member | Parameters | Return | Determinism and status |
| --- | --- | --- | --- |
| `game` | — | Empty table | **surface only (spec).** SPEC 04.1 exposes the namespace but #65 ships no members. |
| `game:end(...)` | Not specified | Not specified | **spec.** SPEC 10.10 describes shared results, but #65 ships no method or backing action. |

Do not infer turns, rounds, scores, or teams APIs under `game`; those belong to the separately versioned Lua standard library and are a non-goal of this reference.

### `scene`

Deterministic entity lookup and tag queries; **implemented (kernel v1, #65 / PR #74)**.

#### `scene:get(id)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `id: EntityId` — stable entity identity.
- **Returns:** the matching semantic entity proxy, or `nil` for a missing ID.
- **Determinism:** identity lookup is canonical; it must not consult renderer objects.

```lua
local piece = scene:get(state.active_piece_id)
```

#### `scene:find(name)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `name: string` — authored entity name.
- **Returns:** the first matching entity proxy in ascending EntityId order, or `nil`.
- **Determinism:** duplicate names resolve by ascending stable EntityId. Prefer `refs` or stable IDs.

```lua
local board = scene:find("Board")
```

#### `scene:query(filter)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `filter: { tags?: string[] }`. Every requested tag must be present; an absent `tags` field returns all entities.
- **Returns:** an array of matching proxies.
- **Determinism:** results use ascending stable `EntityId` order.

```lua
local enemies = scene:query({ tags = { "enemy", "unit" } })
```

`scene:spawn` and `scene:destroy` are omitted from creator API v1 because #64 did not register backing actions.

### `players`

Canonical player lookup and deterministic player ordering; **implemented (kernel v1, #65 / PR #74)**.

#### `players:list()`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** none.
- **Returns:** an array of `Player` proxies.
- **Determinism:** seated players use ascending SeatId order; unseated participants follow in ascending PlayerId order. Duplicate seat assignments include a player only at the first SeatId. This order is the basis for deterministic loops such as dealing.

```lua
state.player_ids = {}
for index, player in ipairs(players:list()) do
    state.player_ids[index] = player.id
end
```

#### `players:get(id)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `id: PlayerId`.
- **Returns:** the matching `Player` proxy, or `nil`.
- **Determinism:** stable identity lookup.

```lua
local active = players:get(state.active_player_id)
```

#### `players:count()`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** none.
- **Returns:** the canonical player count as an integer.
- **Determinism:** counts records in canonical `players` state.

```lua
state.started_with = players:count()
```

#### `players:by_seat(seat_id)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `seat_id: SeatId`.
- **Returns:** the player assigned to that seat, or `nil`.
- **Determinism:** canonical seat assignment lookup.

```lua
local dealer = players:by_seat("dealer")
```

### `random`

Versioned canonical PRNG utilities; **implemented (kernel v1, #65 / PR #74)**. All methods consume RNG stored in game state. They never use Lua entropy, browser time, or presentation randomness. An aborted transaction discards uncommitted RNG state.

#### `random:int(min, max)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** safe integers `min <= max`; the inclusive interval may contain at most 2^32 values.
- **Returns:** a deterministic integer in the inclusive `[min,max]` range.
- **Determinism:** consumes canonical RNG in a replayable way.

```lua
local first_player_index = random:int(1, players:count())
```

#### `random:float()`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** none.
- **Returns:** the canonical PRNG's deterministic finite value in `[0,1)`.
- **Determinism:** consumes canonical RNG and returns `[0,1)`.

```lua
local sample = random:float()
```

#### `random:choice(list)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `list: table` used as an ordered array.
- **Returns:** one deterministic member, or `nil` for an empty list.
- **Determinism:** selection depends on canonical RNG and the supplied array order. Never build the list from unordered table-key iteration.

```lua
local color = random:choice({ "red", "green", "blue" })
```

#### `random:shuffle(list)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `list: table` used as an ordered array.
- **Returns:** a new shuffled array; the input is unchanged.
- **Determinism:** consumes canonical RNG. This list utility is distinct from `Deck:shuffle()`, which queues [`deck.shuffle`](./actions.md#deckshuffle) and never accepts a caller-provided resulting order.

```lua
local initiative = { "red", "green", "blue" }
local shuffled = random:shuffle(initiative)
```

### `timer`

Named one-shot callback registration and cancellation; **implemented (kernel v1, #65 / PR #74)**.

#### `timer:after(delay, callback_name)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `delay: positive finite number` in seconds; `callback_name: non-empty string` naming a global function in the same script.
- **Returns:** a deterministic `TimerId` of the form `timer_<parentActionId>_<zeroBasedIndex>`.
- **Determinism:** queues `timer.register` with the current script/binding identity and, for an entity binding, its entity ID.

```lua
local timer_id = timer:after(5, "finish_turn")
```

Callbacks must be named functions, not anonymous closures. A closure captures VM-local memory that cannot be reconstructed; a name can be resolved again from immutable Release code in a fresh VM.

#### `timer:cancel(timer_id)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `timer_id: TimerId`.
- **Returns:** `nil`.
- **Determinism:** queues `timer.cancel`; the ID must name a scheduled timer. Unknown, fired, or already-canceled timers reject the whole parent transaction.

```lua
timer:cancel(state.pending_timer_id)
```

### `ui`

Structured canonical prompt creation; **implemented (kernel v1, #65 / PR #74)**. This namespace does not expose arbitrary DOM or custom UI. A player answers through [`prompt.respond`](./actions.md#promptrespond).

#### `ui:prompt(player, schema)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `player: Player`; `schema: { id: non-empty string, title?: string, choices: non-empty CanonicalValue[], default?: CanonicalValue }`.
- **Returns:** `schema.id`.
- **Behavior:** queues `prompt.create` with kind `choice`. The optional default must be canonically equal to one of the choices; the ID must not already exist.

```lua
ui:prompt(player, {
    id = "action",
    title = "Choose",
    choices = { "trade", "pass" },
})
```

#### `ui:confirm(player, schema)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `player: Player`; `schema: { id: non-empty string, title?: string, default?: boolean }`.
- **Returns:** `schema.id`.
- **Behavior:** queues a confirmation prompt. A response must be boolean.

```lua
ui:confirm(player, { id = "end_turn", title = "End your turn?" })
```

#### `ui:number_prompt(player, schema)`

- **Status:** **implemented (kernel v1, #65 / PR #74)**.
- **Parameters:** `player: Player`; `schema: { id: non-empty string, title?: string, min: finite number, max: finite number, step?: positive finite number, default?: finite number }`.
- **Returns:** `schema.id`.
- **Behavior:** `step` defaults to `1`; `min <= max`. Defaults and responses must lie inside the inclusive range and make `(value - min) / step` an integer.

```lua
ui:number_prompt(player, {
    id = "bid",
    min = 0,
    max = 10,
    step = 1,
    default = 3,
})
```

All three methods require an existing canonical player. `title` defaults to the empty string, and extra schema keys are not forwarded. A valid `prompt.respond` marks the prompt resolved, then invokes every `on_prompt(ctx)` subscriber in BindingId order with `ctx.promptId`, `ctx.playerId`, `ctx.response`, `ctx.actor`, and `ctx.player` (the responding player proxy).

### `turns`

Deterministic turn convenience state stored under canonical `state`; **implemented (kernel v1, #65 / PR #74)** as `luaStdlibVersion: 1`, not a kernel primitive.

#### `turns:start(first?)`

**implemented (kernel v1, #65 / PR #74).** Rebuilds the turn order from `players:list()`, selects one-based index `1`, optionally selects the matching `Player` or `PlayerId`, marks turns active only when at least one player exists, and returns `turns:current()`. An unmatched `first` leaves index `1` selected.

#### `turns:current()`

**implemented (kernel v1, #65 / PR #74).** Returns the current `Player` proxy, or `nil` when stopped or when the stored player is no longer present.

#### `turns:next()`

**implemented (kernel v1, #65 / PR #74).** When active, advances cyclically through the stored order and returns the next current player; otherwise returns `nil`.

#### `turns:index()`

**implemented (kernel v1, #65 / PR #74).** Returns the stored one-based index. It is `0` before the first start, `1` after starting even with no players, and remains unchanged by `stop()`.

#### `turns:is_current(player)`

**implemented (kernel v1, #65 / PR #74).** Accepts a `Player` proxy or `PlayerId` and returns whether it matches the current player; `nil` and stopped turns return `false`.

#### `turns:stop()`

**implemented (kernel v1, #65 / PR #74).** Marks turns inactive without discarding the stored order or index and returns `nil`.

```lua
function on_start(ctx)
    local first = turns:start()
    if first then state.first_player_id = first.id end
end

function on_press(ctx)
    if turns:is_current(ctx.player) then
        local next_player = turns:next()
        state.current_player_id = next_player and next_player.id or nil
    end
end
```

### `scores`

Deterministic score convenience state stored under canonical `state`; **implemented (kernel v1, #65 / PR #74)** as `luaStdlibVersion: 1`. Leader ties use stable player ordering.

#### `scores:set(subject, value)`

**implemented (kernel v1, #65 / PR #74).** Uses a proxy's `id` or the supplied scalar as the canonical table key, stores `value`, and returns it. The enclosing state extraction requires the resulting score state to remain canonical and finite.

#### `scores:add(subject, amount)`

**implemented (kernel v1, #65 / PR #74).** Adds `amount` to the prior score (default `0`), stores the result, and returns it.

#### `scores:get(subject)`

**implemented (kernel v1, #65 / PR #74).** Returns the subject's stored value or `0`.

#### `scores:leader()`

**implemented (kernel v1, #65 / PR #74).** Compares players in `players:list()` order and returns the first player with the highest score, so ties use ascending seat then unseated PlayerId order. Returns `nil` when there are no players; non-player score subjects are not candidates.

```lua
function on_enter(ctx)
    if ctx.player then
        scores:add(ctx.player, 1)
        local leader = scores:leader()
        state.leader_id = leader and leader.id or nil
    end
end
```

Both modules store their data below `state.__stdlib`. Releases pin them with `luaStdlibVersion` independently of `kernelVersion` and `luaApiVersion`; v1 is the only shipped version. See the [release bundle format](./bundle-format.md) for the compatibility field and its backward-compatible default.

### `data`

An empty namespace reserved for packaged release data; **surface only (spec)** in creator API v1.

| Member | Parameters | Return | Determinism and status |
| --- | --- | --- | --- |
| `data` | — | Empty table | **surface only (spec).** SPEC 04.1 exposes packaged release data but #65 ships no lookup members. |

Do not assume a loader, path syntax, mutability model, or iteration order until the v1 member surface is specified.

## 5. Semantic proxies

Proxy operations expose tabletop meaning, never renderer objects. Every row in the tables below is **implemented (kernel v1, #65 / PR #74)**. Read operations do not queue actions; every mutating method appears in `PROXY_ACTIONS` and maps to the linked registered script-source action. Methods without a shipped binding are omitted and remain **spec**.

### Card

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `is_face_up` | Field: `boolean` | Current `flippable.flipped` value when present, otherwise the authored card `faceUp` value. | None; read only. |
| `flip` | `card:flip()` | Toggles face orientation; requires the entity to be flippable and a player guard when player-originated. | [`entity.flip`](./actions.md#entityflip) |
| `set_face_up` | `card:set_face_up(value: boolean)` | Queues a flip only when the requested orientation differs. | [`entity.flip`](./actions.md#entityflip) |
| `definition_id` | Field: `string` | Identifies the authored card definition. | None; read only. |
| `definition` | Field: CanonicalValue or nil | Reads the matching value from the release's definitions map. VM-local edits are neither persisted nor canonical. | None. |

```lua
if not self.is_face_up then self:flip() end
```

### Deck

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `count` | Field: integer | Number of cards currently in the deck. The last item is top in v1. | None; read only. |
| `shuffle` | `deck:shuffle()` | Reorders with canonical RNG; caller never supplies the result. | [`deck.shuffle`](./actions.md#deckshuffle) |
| `draw_to` | `deck:draw_to(target: Container, count?: number)` | Draws canonical top card identity/identities to a container; `count` defaults to `1`. | [`deck.draw_to_container`](./actions.md#deckdraw_to_container) |

`draw_to_world`, `deal`, `insert_top`, and `insert_bottom` are omitted because #64 provides no exact backing action for those signatures.

### Hand

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `count` | Field: integer | Number of contained entities visible through this proxy. | None; read only. |
| `list` | `hand:list()` | Returns contained proxies in ascending stable EntityId order. | None; read only. |
| `add` | `hand:add(entity: Entity, index?: number)` | Transfers an entity into the hand. `index` is a zero-based insertion index and defaults to the current length (append). | [`container.move`](./actions.md#containermove) |
| `remove` | `hand:remove(entity: Entity)` | Removes an entity to world using `to = nil, index = 0`. | [`container.move`](./actions.md#containermove) |
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
| `add` | `container:add(entity: Entity, index?: number)` | Atomically transfers an entity into this container. `index` is zero-based and defaults to current length. | [`container.move`](./actions.md#containermove) |
| `remove` | `container:remove(entity: Entity)` | Atomically removes an entity to world using `to = nil, index = 0`. | [`container.move`](./actions.md#containermove) |
| `move_to` | `container:move_to(entity: Entity, target: Container, index?: number)` | Atomically transfers from this container to `target`; the zero-based index defaults to the target's current length. | [`container.move`](./actions.md#containermove) |

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
| `set` | `text:set(value: string)` | Sets a canonical string of at most 4,096 UTF-8 bytes. | [`text.set`](./actions.md#textset) |

```lua
refs.status:set("Round " .. state.round)
```

### Player

| Member | Kind and signature | Behavior | Canonical action |
| --- | --- | --- | --- |
| `id` | Field: `PlayerId` | Stable logical participant identity; reconnect keeps the same ID. | None; read only. |
| `name` | Field: `string` | Canonical player name, falling back to `PlayerId` when absent. | None; read only. |
| `seat` | Field: read-only seat record or nil | Canonical seat assignment shaped as `{ id = SeatId }`. | None; read only. |
| `hand` | Field: `Hand` or `nil` | The player's semantic hand when configured. | None; read only. |

```lua
if player.hand then refs.main_deck:draw_to(player.hand, 1) end
```

The following required SPEC 04 members remain **spec** because #65 deliberately ships no binding: packaged-module `require`; `scene:spawn`/`scene:destroy`; Deck `draw_to_world`/`deal`/`insert_top`/`insert_bottom`; Die `set_value`; SnapPoint `detach`; Button `set_enabled`/`set_label`; Player `connected`/`role`/`message`; game callbacks `on_player_disconnect`/`on_player_removed`; entity callbacks `on_click`/`on_spawn`/`on_destroy`; and guard `can_click`. Generic entity movement/locking and the registered stack command surface likewise have no public Lua proxy method. The `rounds` and `teams` stdlib modules and `game:end` are not shipped. Unmapped surface is not permission to queue raw actions or invent method names.

## 6. Timers and prompts

Timers and prompts cross fresh Lua VMs and the ordered network stream, so their canonical identity is part of the contract. This complete flow uses both shipped surfaces:

```lua
function on_start(ctx)
    turns:start()
end

function on_player_join(ctx)
    ui:confirm(ctx.player, {
        id = "ready",
        title = "Ready to begin?",
        default = false,
    })
end

function on_prompt(ctx)
    if ctx.promptId == "ready" and ctx.response then
        state.advance_timer = timer:after(5, "advance_turn")
    end
end

function advance_turn(ctx)
    local next_player = turns:next()
    state.current_player_id = next_player and next_player.id or nil
end
```

`ui:confirm` queues `prompt.create`. The player's `prompt.respond` action must target the open prompt and pass schema validation; a valid response stores canonical state before delivering `on_prompt`. That callback registers a timer with a generated ID plus the immutable script/binding/function identity.

Per ARCH-007, the Room Durable Object schedules due delivery but never executes game rules. It contributes `system.timer_fire` to the ordered stream; the kernel atomically changes the timer from `scheduled` to `fired` and invokes only the stored binding's named callback. A duplicate fire, or a fire after `timer:cancel(state.advance_timer)`, rejects. This is the exactly-once kernel boundary; service restart durability belongs to the room scheduler.

Do not pass an anonymous closure: `timer:after` accepts a callback name string, and a fresh VM reloads that name from immutable release code. Store future-relevant values in `state`, not captured locals. Prompt IDs are creator-supplied `schema.id` values and must be unique for the canonical state's lifetime; there is no shipped `ui` cancellation method even though the kernel has a script/system `prompt.cancel` command.

## 7. Callbacks and guards

### Game callbacks

All callbacks in this table are **implemented (kernel v1, #65 / PR #74)**.

| Callback | Trigger contract |
| --- | --- |
| `on_start(ctx)` | After `game.started`; context contains canonical `settings` and `actor`. |
| `on_player_join(ctx)` | After `player.joined`; `ctx.player` contains the joined canonical player record and `ctx.actor` is the system actor. |
| `on_prompt(ctx)` | After a valid `prompt.respond`; context contains `promptId`, `playerId`, `response`, `actor`, and the responding `Player` proxy as `ctx.player`. |

### Entity callbacks

All callbacks in this table are **implemented (kernel v1, #65 / PR #74)** and dispatch only to bindings on the indicated entity.

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

Every callback adds the parent ordered `actor`. When that actor is a player, `ctx.player` is the matching `Player` proxy. Entity deliveries expose `ctx.object` from the event's moved/pressed/rolled entity ID: for zone callbacks it is the entering/leaving entity, and for container callbacks it is the transferred entity. Event-specific fields such as `entityId`, `zoneId`, `from`, `to`, `response`, and `timerId` remain available directly on `ctx`.

### Guards

The **implemented (kernel v1, #65 / PR #74)** guard list, limited to registered player-action hook points, is:

- `can_grab(ctx)`
- `can_drop(ctx)`
- `can_flip(ctx)`
- `can_press(ctx)`

Guards are enforced read-only transactions. Return `false, "reason"` to deny or `true` to allow; only a literal boolean `false` denies. `state`, `settings`, and `props` are recursively read-only, `turns`/`scores` are not installed, proxy mutations and prompt commands fail at the queue boundary, random calls fail, and timer allocation fails. Any attempted mutation or guard error emits `script.error` and rejects the action. A clean denial rejects without a script error. Either outcome leaves gameplay state unchanged while consuming sequence.

```lua
function can_grab(ctx)
    return ctx.player.seat.id == props.seat_id,
        "Only this seat may move this piece."
end
```

Here the boolean allows the matching seat and denies every other seat; the second return value explains a denial to the player. The guard only reads canonical context and binding props.

### Subscriber and subcommand order

The shipped runtime discovers entity `script` components whose `scriptId` exists in the release, carrying their stable `bindingId`, `props`, and `entityId`. Global event callbacks run across all discovered bindings; entity events filter to the bound entity; timer events filter to the stored binding. Subscribers execute in lexicographically ascending `ScriptBindingId` order.

Normal callbacks may queue deterministic subcommands. Commands from a callback execute FIFO inside the parent transaction, and their emitted events join the same deterministic event queue. These rules are observable and gameplay-significant. Never rely on filesystem order, Lua table-key order, editor display order, or renderer traversal order.

If any subscriber or queued subcommand fails, the parent top-level transaction aborts, including earlier uncommitted callback changes.

## 8. Failure and budgets

`LuaErrorKind` is a stable five-value diagnostic surface:

| Kind | Meaning |
| --- | --- |
| `runtime` | Lua execution or host-call failure, including sandbox misuse. |
| `syntax` | The script could not be compiled. |
| `budget_exceeded` | The deterministic instruction hook reached the configured limit. |
| `memory_exceeded` | The Wasmoon allocation ceiling was reached. |
| `extraction` | Returned script state could not become canonical data, for example a function, cycle, sparse array, mixed-key table, nonfinite number, or unsafe integer. |

The kernel may additionally report `validation` or `application` for a queued command and `command_budget_exceeded` when a transaction queues more than its configured command limit (default `1,024`). These are script diagnostic kinds, not `LuaErrorKind` values.

`script.error` records `script`, `binding`, `function`, nullable `line`, `message`, `kind`, and `sequence`. The error accompanies `action.rejected` and aborts the entire top-level transaction, including prior state writes, RNG draws, and FIFO commands. Only sequence advances.

```lua
function on_press(ctx)
    refs.score:add(1)
    error("score rule failed") -- the queued add is rolled back
end
```

Every sandbox invocation requires a positive integer instruction budget and may set a positive memory budget. The desktop playtest currently supplies 50,000 instructions and 512 KiB of additional Lua memory per invocation; library callers choose their own values. Budget signals cannot be swallowed by `pcall`/`xpcall`. There is no separate shipped recursion or persistent-state byte limit, so this reference does not claim one; canonical extraction, instruction, memory, and command checks are the implemented boundaries.

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
