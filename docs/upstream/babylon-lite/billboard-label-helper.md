---
title: Add billboard support for child label meshes
description: Upstream issue draft for camera-facing Babylon-Lite child meshes.
---

# Add billboard support suitable for child label meshes

## Problem

Babylon-Lite has atlas billboard systems, but a regular `Mesh` has no `billboardMode` or small helper equivalent to Babylon.js `Mesh.BILLBOARDMODE_ALL`. A dynamic-texture plane parented to a moving piece therefore inherits the piece rotation and cannot remain camera-facing without application-owned per-frame orientation math.

This is especially visible for counter values: a flat top label becomes unreadable at shallow orbit angles, while a camera-facing label remains useful throughout the camera range.

## Minimal reproduction

```ts
import { createPlane, onBeforeRender, setParent } from "@babylonjs/lite";

const label = createPlane(engine, { width: 0.56, height: 0.33 });
setParent(label, counterMesh);
label.position.set(0, 0.68, 0);

// Missing: label.billboardMode = BILLBOARDMODE_ALL, or setBillboard(label, camera).
// The application must rebuild the local rotation quaternion every frame (pitch/yaw toward the camera, parent rotation removed).
onBeforeRender(scene, () => orientLabelByHand(label, counterMesh, camera));
```

## Proposed API

A tree-shakeable helper that works for both root and child meshes would fit Lite's functional API:

```ts
const removeBillboard = setBillboard(label, camera, {
  mode: "all", // or "yaw"
  compensateParent: true,
});
removeBillboard();
```

Alternatively, `mesh.billboardMode` with `BILLBOARDMODE_NONE`, `BILLBOARDMODE_Y`, and `BILLBOARDMODE_ALL` constants would ease Babylon.js migration. Parent rotation/scaling should be accounted for, the plane should stay upright in yaw mode, and cleanup must remove any per-frame hook.

## Alternatives considered

- Keeping labels flat is cheap but loses readability at ordinary orbit angles.
- Reparenting labels to the scene avoids inherited rotation but requires manually copying world position and lifecycle from the piece.
- Application-local Euler/quaternion math is small, but is duplicated by every UI-label consumer and easy to get wrong for parent transforms.

## Current downstream workaround

Digipology creates labels as child planes in [`addLabel`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L325-L345). Counters are now raised and reoriented from the adapter's existing per-frame callback (`orientBillboardLabel`: a pitch/yaw quaternion toward the camera with the parent piece rotation removed); cards and dice intentionally remain flat. That adapter-local code can be removed when a native child-mesh billboard helper is available.
