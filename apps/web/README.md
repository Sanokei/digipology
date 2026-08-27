# Digipology web

The React and Babylon.js player and creator app for Digipology. It includes the
game catalog, room join and hosting flows, saved tables, browser editor, and the
presentation-only tabletop scene.

## Development

From the repository root, install workspace dependencies with `bun install`,
apply local D1 migrations once, then start the full application:

```sh
cd apps/worker
bunx wrangler d1 migrations apply digipology --local
cd ../..
bun run dev
```

The full stack is served at `http://127.0.0.1:8787`. For frontend hot reload,
leave the worker running and start `bun run dev:web` in another terminal; Vite
serves `http://127.0.0.1:5173` and proxies `/api` to the local worker.

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
