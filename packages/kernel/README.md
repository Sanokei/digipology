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
