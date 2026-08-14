# ADR-0005: Mobile support & renderer weight strategy

Status: Accepted · Date: 2026-08-14

## Context

Owner direction: play.digipology.com must run well on phones; "if it's too heavy there is Babylonjs-Lite." Ground truth: the capsule home is already responsive (kino transplant, verified at 375px), but the table page has no touch interaction (wave-1 non-goal) and the Babylon vendor chunk is 1,587 kB (370 kB gzip). Recon of Babylon-Lite (the owner contributes to BabylonJS/Babylon-Lite): ~20–30× smaller bundles, real multi-touch camera controls, CI-enforced pixel parity — but **WebGPU-only with no WebGL fallback, permanently, by design**, and it deliberately omits sync `scene.pick`, `onPointerObservable`, and `HighlightLayer` — exactly Digipology's current interaction layer (confined to 3 files: `useBabylonScene.ts`, `table.ts`, `dragBehavior.ts`).

## Decisions

1. **Touch interaction per SPEC 02.6** on the table page: tap select, drag selected/grabbable object (same predict/canonical path as pointer drag), long-press context menu (≈450 ms, move-cancelled), two-finger orbit/pan, pinch zoom, double-tap primary action. `touch-action: none` on the canvas; pull-to-refresh and overscroll suppressed during interaction; drag transients throttled to the existing transient channel.
2. **Responsive table layout**: `100dvh` layout (no iOS URL-bar jump), compact top bar, bottom hand tray sized for thumbs, player panel/chat as sheets, hit targets ≥ 40 px, `SafeArea` insets honored. Editor remains desktop-only (PRD-MOB-003) — its gate already exists.
3. **Renderer weight — measure, then cut, then reassess**:
   a. Wave now: audit the three scene files' imports; eliminate barrel/`Engine`-pulled bloat (deep `@babylonjs/core` subpaths, no side-effectful imports beyond required registrations). Target: vendor chunk ≤ 200 kB gzip without behavior change; record before/after in the PR.
   b. Device-adaptive quality: clamp `devicePixelRatio` (≤ 2, runtime-adjustable), disable shadows/antialias on low-tier heuristics, cap render loop when tab hidden.
   c. **Babylon-Lite adoption is deferred, not rejected**: revisit as a progressive enhancement (Lite scene when `navigator.gpu` exists, WebGL path otherwise) once (i) the tree-shaken WebGL bundle is still the measured mobile bottleneck, and (ii) we accept maintaining two scene implementations. Tracked as a backlog issue; a slow table beats a black canvas on non-WebGPU phones.
4. **Verification bar**: production smoke extended with a mobile-UA/viewport pass; manual acceptance on the owner's phone for feel (drag, pinch, long-press) — automated tests cover the gesture state machines and layout breakpoints.

## Consequences
- No engine swap risk now; the interaction layer stays sync-pick WebGL.
- Bundle work is measurable and reversible; Lite path stays open with a clean 3-file port surface.
