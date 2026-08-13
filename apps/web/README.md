# Digipology web

The private React and Babylon.js player shell for Digipology. It contains the
action-oriented home and placeholder routes, plus a presentation-only tabletop
scene that demonstrates immediate local pointer dragging.

## Development

From the repository root, install workspace dependencies with `bun install`.
Then run the app with `bun run --cwd apps/web dev`.

Useful checks:

- `bun test`
- `bun run --cwd apps/web typecheck`
- `bun run --cwd apps/web build`

## Manual verification for issue #7

- Open the table demo from **Host game**, drag the cube across and beyond the
  table edge, and confirm it lifts, follows the table plane, clamps to the
  playable bounds, and drops on release.
- Confirm the camera orbits, pans, and zooms normally, but does not move while
  the cube is held.
- Resize the viewport through and below 768px and confirm the canvas and shell
  reflow without overflow.
- Hard-refresh `/join/AB-CDE` and confirm the normalized code is shown.
- In React development mode, navigate between the table and another route at
  least ten times. Confirm via the browser's performance/devtools panels that
  animation frames and WebGL contexts return to their prior count after each
  unmount. React StrictMode intentionally exercises a double mount on startup.

Route component smoke tests are deferred until the repository adopts a DOM
test environment. The route table is typechecked and exercised by the Vite
build; browser-level route coverage can be added with Playwright later.
