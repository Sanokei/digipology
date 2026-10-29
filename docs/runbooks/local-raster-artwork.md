# Local raster artwork acceptance

Base source: 194dbac54647c4474d3ab11934843cbf30356fd0.

Audit: private drafts have no raster upload/preview/persistence; published cover
selection exposes procedural SVG options. The cover client always declares PNG,
even though the server accepts JPEG/WebP. Server sniffing accepts header-only
PNG/JPEG/WebP fixtures, and uploaded cover URLs overwrite one R2 object despite
versioned immutable cache promises. Credits have no persisted handoff.

This increment completes cover artwork only. It does not add model/audio/music
or live image-provider provisioning.

Acceptance:

1. A validated/imported draft can receive a real local PNG/JPEG/WebP cover,
   decode it, fit a visible 2:3 crop and deliberately matte transparent pixels.
   Bound dimensions/bytes, use the actual encoded MIME type, reject broken files
   and retain the previous valid image after a failed replacement.
2. Private play shows the actual image and credit. Normal draft saves/downloads
   and imports retain bytes, checksum, attribution, tagline and review metadata.
   A corrupted saved asset has visible replace/remove recovery; game play stays
   available and publication cannot silently drop the chosen image.
3. Explicit publication uploads the selected image through the owned cover API,
   retains credits, retries without duplicating the game/asset version, and does
   not open a table while its artwork save failed. Published reload/download
   preserves actual bytes and attribution; earlier cover versions remain stable.
4. Exercise real browser decoding, alpha matte pixels, dimensions, storage,
   failed replacement/import/upload and recovery on desktop and 390px layouts.
   Use existing local Digipology raster illustrations and explicit test fixtures.
   Do not describe them as live generated or online-sourced assets.

Primary sources consulted:

- [MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
- [MDN canvas.toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
- [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container)
- [PNG specification](https://www.w3.org/TR/png-3/)

createImageBitmap applies source orientation;
toBlob may fall back to PNG when a requested encoder is unsupported. WebP VP8X
is an extended header, not a complete image; image data and valid chunk bounds
must also exist. The implementation must validate the actual output type.

Container admission is not a codec decoder. Imported artwork also undergoes
real browser decoding; raw cover API callers receive structural admission only.
Missing/undecodable published images retain a visible retry path. No image data
or artwork credit enters the deterministic bundle, release identity or replay.

Deployment prerequisite: apply D1 migration 0008 before using new cover uploads.
Existing current legacy covers remain readable during rollout, and migration
preserves their pointer; historical bytes lost before this change cannot be
reconstructed. A failed migration/storage write must not move the current cover.

The provider/network draft is still unconfigured/unpublished and scheduled
Actions execution remains unverified. Source-pinned QA pack for the base is
qa/194dbac-creator-handoff on qa/creator-handoff-194dbac, pack commit
baa8f65180733f4bd1c7623dbbee143a4d904828.
