---
title: Add a lightweight main-scene mesh highlight facility
description: Upstream issue draft for Babylon-Lite mesh highlighting without material mutation.
---

# Add a lightweight main-scene mesh highlight/outline facility

## Problem

Babylon-Lite has no main-scene equivalent of Babylon.js `HighlightLayer` or a per-mesh outline mode. Applications therefore have to change a mesh's real material to represent hover, selection, or held state. That mixes transient interaction feedback into presentation materials, requires manual UBO invalidation, and cannot produce a consistent silhouette around textured or emissive pieces.

## Minimal reproduction

```ts
import { createBox, createStandardMaterial, markMaterialUboDirty } from "@babylonjs/lite";

const piece = createBox(engine, { width: 1, height: 0.2, depth: 1 });
const material = createStandardMaterial();
piece.material = material;

// There is no outline/highlight API, so interaction feedback mutates the base material.
material.emissiveColor = [0.23, 0.16, 0.05];
markMaterialUboDirty(material);
```

## Proposed API

A tree-shakeable main-scene helper would be enough; it need not reproduce every `HighlightLayer` feature:

```ts
const highlight = createMeshHighlight(scene, {
  color: [1, 0.85, 0.55],
  width: 0.03,
});
highlight.addMesh(piece);
highlight.removeMesh(piece);
highlight.dispose();
```

An equally useful shape would be `setMeshOutline(mesh, options | null)`. The important properties are main-scene meshes, no mutation of the assigned material, multiple independently controlled meshes, and explicit cleanup.

## Alternatives considered

- Mutating `emissiveColor` is small but changes the authored material and gives no silhouette.
- Cloning/scaling the mesh creates z-fighting, extra geometry, and awkward child/submesh behavior.
- A utility-layer gizmo highlight does not cover arbitrary meshes in the main scene.

## Current downstream workaround

Digipology maps hover/selected/held to emissive RGB values, mutates each piece material, and calls `markMaterialUboDirty`: [`HIGHLIGHT_COLORS`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L83-L87) and [`applyPieceHighlight`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L301-L309).
