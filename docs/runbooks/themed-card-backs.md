# Card stock corners and game-specific backs

The user reported incorrect corners and requested different back images for
different games after the fbc1d4b renderer checkpoint. Preserve that source and
its a3f4935 QA pack; it is not the acceptance source for this follow-up.

The corner audit found inconsistent painted/physical radii and face margins,
deck walls shaded like pillows, paper strips extending into rounded corners,
and a single-card body almost one quarter as thick as a full deck. Use one
width-relative poker-stock profile, vertical wall normals, shallow bevels,
thin stock and an exact shared raster clip. Preserve authored transforms and
canonical rules; map legacy near-table card center offsets in presentation only.

Back images must be shared by decks, face-down cards and concealed inspection.
Use existing raster game illustrations for built-in defaults, plus an explicit
creator-owned back image/credit file in runtime/presentation/card-back.json.
Normal File → Card backs lets a creator use the current cover or upload raster
artwork. This is deliberately pinned release presentation, separate from the
editor-only cover/review; export text must say so. Validate full bytes, hash,
dimensions and actual browser decoding before replacement; enforce the combined
release budget before mutating. This single shared back does not multiply image
bytes by the number of cards. Do not silently inject cover bytes into exports.

Images load asynchronously with a readable loading/fallback/failure/retry state.
Callbacks must not update disposed GPU resources or a different game's texture.
Both renderers and the 2D inspector use the same image and contour. Back models
contain public game branding only, never the concealed card's rank/definition.

Acceptance: inspect stock/front/back/deck corners at normal and enlarged scale;
actual two games with different raster backs, desktop/390/short inspection,
normal editor save/import/export/private/public/reload/guest flow and exact
asset/credit preservation. Check missing/decode/retry, source switch/disposal,
hidden-hand presentation and picking/flip in actual WebGL and WebGPU. Keep
source-by-frame scopes and captured command exits. Only affected checks are
needed. Live original art generation, perceptual sound/fun and production remain
outside this local fixture/authoring verification.
