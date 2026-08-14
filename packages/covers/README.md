# digipology-covers

Zero-runtime-dependency CoverSpec normalization, procedural generation, and
deterministic SVG rendering for Digipology's 336 x 504 cover system.

The renderer emits only inline SVG shapes and plain text. It never emits
scripts, foreign objects, links, images, event handlers, or external
references. Callers should still normalize every untrusted extracted payload
with `normalizeCoverSpec` before rendering it.

```ts
import { normalizeCoverSpec, renderCoverSvg, seededSpec } from "digipology-covers";

const spec = normalizeCoverSpec(modelPayload) ?? seededSpec("my-game");
const svg = renderCoverSvg(spec, { title: "My Game", tagline: "Deal boldly." });
```

Generated SVG is intended for preview and client-side rasterization. The
platform cover endpoint stores raster PNG, JPEG, or WebP bytes only.
