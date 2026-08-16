# Table renderer parity runbook

Use this checklist before changing either table scene adapter. Test the same release and room once with `?renderer=lite` and once with `?renderer=webgl`. Confirm the console does not report an unexpected fallback; a requested Lite renderer on a WebGPU-absent device must log the fallback and show a working WebGL table.

## Automated coverage

- `rendererPolicy.test.ts`: WebGPU present/absent, both overrides, invalid override, and the no-WebGPU Lite fallback decision.
- `mountSceneAdapter.test.ts`: Lite mount failure disposal and WebGL remount; WebGL failures remain visible.
- `sceneInteraction.test.ts`: async target resolution preserves the 450 ms long-press and drag thresholds, stale cancellation preserves double-tap state, and hover picks are coalesced.
- `sceneAdapter.contract.shared.ts`, `sceneAdapter.contract.test.ts`, and `sceneAdapter.contract.webgl.test.ts`: the same sync/create/update/destroy, async pick-to-gesture, drag payload, grabbability, highlight, 180 ms correction, camera, pause, and disposal contract runs against both real adapters. Lite uses a thin mocked Lite engine; WebGL uses Babylon's `NullEngine` and the real `attachDragBehavior` through injected browser-owned construction surfaces.
- Existing `dragBehavior.test.ts`, `dragActions.test.ts`, `touchGestures.test.ts`, and `rendererTier.test.ts` remain the shared pure behavior floor.
- `bun run --filter digipology-web check-chunks` verifies the built vendor chunks do not contain symbols from the other engine.

## Manual checklist

| Check | WebGL desktop | Lite WebGPU desktop | Owner phone | Notes |
| --- | --- | --- | --- | --- |
| Tap selects a piece | Not yet executed | Not yet executed | Not yet executed | |
| Drag/drop reaches the expected zone or snap | Not yet executed | Not yet executed | Not yet executed | Compare `entity.grab`/`entity.drop` payloads |
| Long-press opens the object menu near 450 ms | Not yet executed | Not yet executed | Not yet executed | Moving beyond slop must cancel |
| Double-tap/double-click runs the primary action | Not yet executed | Not yet executed | Not yet executed | Card/flippable flips, die rolls, deck draws to hand, button presses, and other pieces inspect |
| Two-finger orbit/pan | Not yet executed | Not yet executed | Not yet executed | |
| Pinch zoom | Not yet executed | Not yet executed | Not yet executed | Lite blocks `attachControl`'s native touch path so only the shared gesture machine applies pinch |
| Rejected prediction animates correction | Not yet executed | Not yet executed | Not yet executed | Both use a 180 ms easing window |
| Card, die, and counter labels remain legible | Not yet executed | Not yet executed | Not yet executed | Lite card/die labels stay top-facing; counter labels are raised camera-facing planes |
| Hover/selected/held feedback is clear | Not yet executed | Not yet executed | Not yet executed | WebGL outline vs Lite emissive affordance |
| Dispose/remount leaves one responsive canvas | Not yet executed | Not yet executed | Not yet executed | Navigate away/back or remount the component |
| Forced Lite without WebGPU shows WebGL, not black canvas | Not yet executed | Not applicable | Not yet executed | Confirm the override hint and Diagnostics Renderer/reason/fallback rows |
| Drag a hand card from the tray onto the table | Not yet executed | Not yet executed | Not yet executed | Card leaves the private hand and appears at the projected drop point |
| Long-press a hand card | Not yet executed | Not yet executed | Not yet executed | Inspect and Play to table are available; moving beyond slop cancels |
| Right-click a table object | Not yet executed | Not yet executed | Not applicable | Opens the same capability menu as touch hold and does not flip immediately |
| Reconnect banner keeps the camera usable | Not yet executed | Not yet executed | Not yet executed | Orbit/pan/pinch remain live while canonical interactions are paused |

Record the phone model, OS/browser versions, WebGPU desktop GPU/driver, date, result, and any screenshots or console diagnostics in the PR before merging.
