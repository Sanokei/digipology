# Scene presentation integration API

These APIs are transient rendering controls. They must never be copied into canonical state, action payloads, replay data, or hashes.

## Settings source

Pass a `PresentationSettingsSource` as `SceneAdapterDependencies.settings`. The shell-owned store supplies `reducedMotion`, `reducedAudio`, `muted`, normalized `volume`, and `tableStyle` (`felt-green`, `dark-wood`, `slate`, or `parchment`). Both adapters subscribe and unsubscribe with their lifecycle. `browserPresentationSettings` is the device-local fallback and defaults reduced motion from `prefers-reduced-motion`.

## Interaction affordances

- `setSelection(ids)` replaces the complete local selection. An empty array clears it.
- `showSnapGhost(entityId, pose)` replaces the single transient snap preview with a non-pickable translucent copy at the proposed pose.
- `clearSnapGhost()` removes that preview. Call it on drop, cancel, mode change, and unmount.
- `animateCardFlight(sourceEntityId, destination, delayMs?)` creates a transient card-shaped flight for authoritative deal/draw events. It is suppressed when reduced motion is enabled.
- Existing `setHighlight(id, "hover" | "held" | "locked" | "selected")` remains compatible. New interaction work should use `setSelection` for selection because it supports more than one entity.

The adapters derive remote held colors from the holder's seat when the player roster is available. Neither highlights, ghosts, nor flights alter `KernelStoreSnapshot`.

Presentation audio is driven from authoritative kernel event batches. Merge, deal, draw/take, spawn, delete, shuffle, and cut events map to the shared scene cues, so rejected actions stay silent and both adapters behave identically.

## Camera and diagnostics

`camera.zoom(deltaY, cursorX, cursorY)` supports cursor-biased zoom. `camera.reset(seatIndex)` restores a seat-relative view, and `camera.toggleTopDown()` switches the presentation camera. `getPerformanceStats()` returns sampled FPS, visible piece count, and cached FaceSpec texture count for the shell diagnostics panel.
