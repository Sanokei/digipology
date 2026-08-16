---
title: Add a touch-gesture opt-out to attachControl
description: Upstream issue draft for disabling Babylon-Lite camera touch gestures.
---

# Add a touch-gesture opt-out to `attachControl`

## Problem

`attachControl` always registers its `touchstart`, `touchmove`, and `touchend` pinch/orbit path. `AttachControlOptions` can decline pointer-down handling or report an external drag/pick, but it cannot leave touch gestures to an application-owned gesture state machine. An application that needs identical gesture arbitration across renderers must currently register `stopImmediatePropagation` listeners before calling `attachControl`; listener order becomes part of correctness and re-attaching controls can accidentally restore the native Lite gesture path.

## Minimal reproduction

```ts
import { attachControl, createArcRotateCamera, createSceneContext } from "@babylonjs/lite";

const scene = createSceneContext(engine);
const camera = createArcRotateCamera(-Math.PI / 2, 0.92, 12, { x: 0, y: 0, z: 0 });
const detach = attachControl(camera, canvas, scene, {
  shouldHandlePointerDown: (event) => event.pointerType !== "touch",
});

// Despite the predicate, attachControl's touch listeners still process a two-finger pinch.
// There is no option that reserves all touch gestures for the application's own handlers.
detach();
```

## Proposed API

Add an opt-in field to `AttachControlOptions`, for example:

```ts
export interface AttachControlOptions {
  handleTouch?: boolean; // default true for backward compatibility
}

attachControl(camera, canvas, scene, { handleTouch: false });
```

When false, `attachControl` should not register or process its `touchstart`, `touchmove`, `touchend`, `touchcancel`, or `gesture*` listeners. Pointer events whose `pointerType` is `"touch"` should likewise not start camera rotation. Detach and re-attach should preserve the option with no duplicate listeners.

## Alternatives considered

- `shouldHandlePointerDown` cannot disable the separate native touch-listener path.
- Reporting every touch as an external drag/pick couples camera controls to application state and still installs competing listeners.
- Capture-order `stopImmediatePropagation` blockers work, but are fragile across re-attachment and make listener ordering observable application behavior.

## Current downstream workaround

Digipology installs four blockers before the first `attachControl`, retains them across camera detach/re-attach, and removes them on adapter disposal: [`blockLiteTouchGesture` and mount ordering](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L288-L292), [listener registration before `attachCamera`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L464-L468).
