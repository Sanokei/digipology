---
title: Support plane-constrained pointer dragging for main-scene meshes
description: Upstream issue draft for Babylon-Lite main-scene pointer dragging.
---

# Support plane-constrained pointer dragging for arbitrary main-scene meshes

## Problem

`createPointerDrag` is designed around utility-layer gizmo colliders. It cannot directly target an application's arbitrary main-scene mesh, so applications reimplement the same interaction using asynchronous GPU picking, screen-ray construction, pointer capture, camera arbitration, bounds, and plane intersection.

## Minimal reproduction

```ts
import { createGpuPicker, createPointerDrag, pickAsync } from "@babylonjs/lite";

const picker = createGpuPicker(scene);
const result = await pickAsync(picker, pointerX, pointerY, {
  filter: (candidate) => candidate === mainScenePiece,
});

// createPointerDrag cannot attach this result to mainScenePiece with a horizontal
// drag plane; it expects utility-layer gizmo collider setup instead.
createPointerDrag(/* utility-layer gizmo inputs */);
```

## Proposed API

Either extend `createPointerDrag` or add a sibling dedicated to main-scene targets:

```ts
const drag = createMainScenePointerDrag({
  scene,
  camera,
  canvas,
  mesh: mainScenePiece,
  plane: { normal: [0, 1, 0], point: [0, restingY, 0] },
  pick: { picker, filter: (mesh) => mesh === mainScenePiece },
  onStart,
  onMove,
  onEnd,
});
drag.dispose();
```

The helper should use async picking, expose pick-pending/drag-active state for camera arbitration, capture/release the pointer, constrain movement to a plane, and provide an explicit disposer. Optional axis/bounds constraints could follow later.

## Alternatives considered

- Moving game pieces into the utility layer changes their rendering/lighting relationship to the table.
- Reusing gizmo-only colliders leaks utility-layer implementation details into normal scene interaction.
- Keeping application-local math works, but every consumer must independently solve camera rays, async-pick races, capture, and cleanup.

## Current downstream workaround

Digipology combines [`pickAsync`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L564-L579), an adapter-local [`createScreenRay`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L164-L195), and shared horizontal-plane intersection in its drag path: [`updateDrag`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L602-L612).
