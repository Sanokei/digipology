---
title: Babylon-Lite upstream candidates
description: Paste-ready Babylon-Lite issue drafts and their owner-managed filing status.
---

# Babylon-Lite upstream candidates

These are paste-ready issue drafts for [BabylonJS/Babylon-Lite](https://github.com/BabylonJS/Babylon-Lite). **Agents never open issues or pull requests on third-party repositories; the owner files each draft and updates its status here.**

| Candidate | Draft | Digipology workaround | Status | What Digipology can delete once merged |
| --- | --- | --- | --- | --- |
| Touch opt-out for `attachControl` | [attach-control-touch-opt-out.md](./attach-control-touch-opt-out.md) | [`blockLiteTouchGesture`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L288-L292) and pre-attach listeners | drafted | Four capture-order-sensitive touch blockers and their lifecycle test |
| Main-scene highlight/outline | [highlight-outline-facility.md](./highlight-outline-facility.md) | [`HIGHLIGHT_COLORS` and `applyPieceHighlight`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L83-L87) | drafted | Emissive-color mutation, UBO dirty marking, and adapter-specific highlight assertions |
| Main-scene pointer drag | [main-scene-pointer-drag.md](./main-scene-pointer-drag.md) | [`pickAsync` plus screen-ray plane dragging](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L564-L612) | drafted | Adapter-local ray construction, active-drag bookkeeping, and plane intersection plumbing |
| Child-mesh billboard labels | [billboard-label-helper.md](./billboard-label-helper.md) | [`addLabel`](https://github.com/Sanokei/digipology/blob/42b2754/apps/web/src/scene/liteSceneAdapter.ts#L325-L345) plus per-frame counter orientation | drafted | Per-frame counter-label quaternion orientation (`orientBillboardLabel`) and parent-rotation compensation |

Statuses should be one of `drafted`, `filed by owner: <url>`, or `merged upstream: <version>`.
