# digipology-kernel

Pure, headless, deterministic game-state transitions for Digipology. The v0
kernel provides canonical state validation, a versioned action registry,
atomic ordered actions, deterministic gameplay RNG, deterministic entity ID
allocation, snapshots, and the first tabletop action set.

## Determinism contract

`applyOrdered` accepts exactly the next sequence number, never mutates its
input, and either commits the complete action or advances only `sequence` and
returns `action.rejected`. Renderer/UI events are derived output and are not
included in canonical state or its hash.

Canonical transforms use a `0.0001` grid. Position and scale coordinates are
bounded to `[-1_000_000, 1_000_000]`. Quaternion inputs must be within `0.001`
of unit length; accepted rotations are normalized and then quantized before
commit. Scale coordinates must be positive.

Deck top is the last item in its container. Container membership is exclusive,
and capacity, counter bounds, entity references, transforms, RNG state, and all
JSON-like values are checked at every transaction boundary.

`die.roll` selects from canonical `die.faces` with the kernel RNG; legacy
`standard_d6` components without that optional field use faces 1 through 6.
The system-only player/seat lifecycle actions maintain canonical roster and
seat bindings, and voluntary departure releases held entities in sorted ID
order.

## Tabletop semantics

Hands use ordinary Container membership. `hand.owner` may name a player or a
seat, and `owner:<id>` container visibility resolves through that canonical
owner; `canonicalOrder: false` leaves visual sorting local-only.

Gameplay tags live in `entity.components.tags.values`. Zones use their
quantized Transform as the shape origin: box scale is full width/height/depth,
and sphere radius is half the largest scale axis. Zone membership is recomputed
only by semantic placement actions and is stored in ascending EntityId order.
Snap points filter by capacity, tag overlap, and radius, then select by distance
and ascending snap-point EntityId on an exact tie. Drop resolution is fixed as
snap, then stack, then zone recomputation, then world fallback.

Stacks are optional top-level canonical records whose last item is the top.
Container, stack, and snap placement are mutually exclusive. The v1 stack
surface supports create, add, remove-top, merge, and dissolve; middle removal is
not a player operation. `container.move` is the shared atomic transfer primitive.

`button.press` uses an injectable read-only `canPress` validation guard. The
default registry allows enabled buttons. `text.set` is limited to 4096 canonical
UTF-8 bytes. Player `entity.set_locked` requires `settings.sandbox === true`;
script locking is always allowed, and locked entities reject player grabs.

## API sketch

```ts
import { applyOrdered, createInitialState, snapshot } from "digipology-kernel";
import { createRng } from "digipology-prng";

const state = createInitialState({
  releaseId: "release_example_1",
  rng: createRng("table-seed").state(),
});

const result = applyOrdered(state, {
  sequence: 1,
  actionId: "act_1",
  actor: { type: "system" },
  action: { type: "system.game_start", payload: {} },
});

const saved = snapshot(result.state);
```

`ActionRegistry` can be instantiated for isolation, while `registerAction`
extends the default registry used by `applyOrdered`. Duplicate action types are
rejected immediately.
