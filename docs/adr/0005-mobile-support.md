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
- The WebGL implementation remains the compatibility floor; Babylon-Lite is a progressive enhancement selected only when WebGPU is exposed and can start.
- The scene interaction layer depends on an engine-neutral adapter with asynchronous picking. The WebGL adapter wraps Babylon.js picking, and the Lite adapter uses `GPUPicker`.
- Maintaining two table scene implementations is accepted. Shared gesture/action code, an adapter contract suite, explicit renderer overrides, and a parity runbook bound the maintenance cost.

## 2026-08-15 amendment: Babylon-Lite progressive enhancement

PR #73 measured the retained Babylon.js WebGL feature floor at approximately 342.5 kB gzip, so the payload condition in decision 3c is met and further import cutting cannot reach the 200 kB target without removing table features. Issue #79 supersedes the measurement gate in #70.

Stage 1 uses option **1b, a static heuristic**, rather than adding analytics. This preserves the site's analytics-free posture and makes no claim about actual Digipology traffic. The table below is a deployment heuristic as of 2026-08-15, not a substitute for testing `navigator.gpu` and handling `createEngine()` failure at runtime.

| Platform/browser floor | Heuristic availability | Digipology path |
| --- | --- | --- |
| Chrome/Edge 113+ on supported Windows D3D12, macOS Metal, or ChromeOS Vulkan hardware | WebGPU enabled by default in the Chromium engine; hardware/driver blocks can still remove `navigator.gpu` | Lite, with mount-time WebGL fallback |
| Chrome/Edge 121+ on Android 12+ with Qualcomm or ARM GPU | WebGPU enabled by default for the initially supported device set; coverage is not all Android hardware | Lite when exposed, otherwise WebGL |
| Safari 26+ on macOS, iOS, iPadOS, and visionOS | WebGPU shipped across Apple platforms | Lite, with mount-time WebGL fallback |
| Firefox 141+ on Windows | WebGPU supported outside service workers | Lite, with mount-time WebGL fallback |
| Firefox 147+ on Apple silicon macOS | WebGPU supported outside service workers | Lite, with mount-time WebGL fallback |
| Chrome 144+ on Linux Intel Gen12+, expanding to modern NVIDIA in 147/148 | Staged hardware/driver rollout rather than universal Linux coverage | Lite when exposed, otherwise WebGL |
| Older iOS/Safari, older or unsupported Android devices, Firefox Android, and unsupported desktop GPU/driver combinations | No dependable WebGPU floor | WebGL |

Sources: [Chrome 113 desktop/ChromeOS launch](https://developer.chrome.com/blog/webgpu-release), [Chrome 121 Android rollout](https://developer.chrome.com/blog/new-in-webgpu-121), [Safari 26 WebGPU launch](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [Firefox 141 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/141), [Mozilla's current platform rollout table](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features#webgpu_api), and [Chrome 144 Linux rollout](https://developer.chrome.com/blog/new-in-webgpu-144).

The target-device list is: the owner's phone (model/browser to be recorded in the parity run), a current Android Chromium phone, a Safari 26 iPhone/iPad, a WebGPU desktop, and one WebGPU-absent phone or forced-WebGL desktop. This spans both renderer paths and the explicit fallback.

**Go decision:** maintain both implementations. The WebGL payload result justifies offering the Lite path, and the static platform evidence suggests a meaningful and growing share of current mobile and desktop browsers can receive it. The application deliberately does not estimate a player percentage without telemetry. Selection is capability-based, not UA-version-based, and every Lite initialization error falls back to WebGL so the decision does not turn unsupported devices into black canvases.

### Lite gaps and deliberate affordances

- Lite has no `HighlightLayer`. Hover, selected, and held feedback use the piece material's emissive color. A reusable main-scene outline/highlight facility should be upstreamed.
- Lite's `createPointerDrag` targets utility-layer gizmo colliders rather than arbitrary table meshes. The adapter uses `pickAsync` plus its own camera ray and reuses `intersectRayWithHorizontalPlaneToRef`; general main-scene pointer drag should be upstreamed.
- Lite labels use `createDynamicTexture`/`updateDynamicTexture` on child planes. The current Lite affordance keeps labels flat on piece tops; a small native billboard helper suitable for child label meshes would close counter-label parity.
- Lite intentionally runs the low-cost lighting path without shadows. This is a quality choice, not canonical state.
- Corrections are interpolated from Lite's render-loop callback using the same 180 ms easing window as WebGL.
