# Artwork authored for each created game

The game author chooses a coherent visual direction and separate cover/back
briefs after reading the requested theme and rules. Image creation runs after
validated rules are saved. It never substitutes a demo game's picture or a
procedural SVG for an unfinished image. The ordinary Create → private play and
File → Game artwork paths share the same controller.

## Scope and acceptance

This increment creates a portrait cover and one default concealed-card back.
Games without cards only need the cover. It does **not** implement custom card
fronts, separate backs for multiple decks, boards, models, music, or a complete
Merlin Economics adaptation. The UI states the multiple-deck limitation.

The earlier cover-as-back approach was rejected: a cover scene, tiny copy and
miniature cards do not make a coherent printed back. New back briefs request a
large emblem, safe edges, contrast at card size and 180-degree symmetry without
rank, suit or ownership clues. Prompt constraints cannot prove aesthetic quality
or symmetry; an actual generated result still needs visual review.

Acceptance uses separate game identities and briefs; actual raster decoding;
unchanged canonical initial state and in-progress private hand; raw and prepared
hashes; owner-only original downloads; normal editor/backup/publication/reload;
and desktop, 390px and short-height recovery controls. A failed replacement keeps
the selected image and its original locator. The failed attempt remains
separately downloadable. Technical transport fixtures do not establish genuine
generation, a good illustration, faithful Merlin rules, balance or fun.

## Existing provider configuration

`AI_IMAGE_MODEL` must be explicitly selected for the existing authorized account.
`AI_IMAGE_BASE_URL` selects its OpenAI-compatible image base; an empty value uses
the existing `AI_BASE_URL`. Remote HTTPS requests use the existing `AI_API_KEY`.
No model, endpoint or paid account is invented by the app. Missing access leaves
rules and art briefs saved, with pending/retry/replace controls. The user may
explicitly publish a draft with only its ready images after jobs have stopped.

Primary source: [official openai-node image API types at
4bfed1f69fc0e86e7da0657df8d54b6e99118c02](https://github.com/openai/openai-node/blob/4bfed1f69fc0e86e7da0657df8d54b6e99118c02/src/resources/images.ts).
The documented generation endpoint supports an explicit model, portrait
1024×1536, WebP compression and base64 output. The implementation requires that
contract; providers with different image APIs need an explicit adapter.
Documentation access is not evidence that this environment can invoke a model.

## Byte and version boundaries

Authenticated `/api/ai/artwork` requests use the draft identity, title, purpose,
full direction and revision as a cache identity scoped to the owner. Originals
and exact rendered prompts/model/time/hashes are saved under `draft-art/v1` in
the existing private R2 bucket before success is returned. Same-process
concurrent requests share work; completed retries use the stored result. This
is not a globally exactly-once guarantee across isolates or interrupted writes.

Only bounded PNG/JPEG/WebP base64 results are admitted (8 MiB, portrait 2:3,
minimum 768×1152, maximum 16 megapixels). A browser pixel decode rejects damaged,
blank or invisible images, then prepares a bounded WebP through the existing
cover crop/card-back contain pipeline. A failed decode preserves the raw
attempt for inspection. Browser storage failure retains prepared bytes in the
tab; retry saving does not ask the provider to create another image.

Public provenance contains the original hash, prompt hash, model and time.
Private owner asset IDs and full prompts stay in editable draft metadata and
the authenticated original receipt. Covers remain separately versioned;
prepared backs live in `runtime/presentation/card-back.json`. Both hashes and
old cover/release versions remain exact. No artwork job state enters gameplay
canonical state. Release export includes its presentation files, without
silently adding cover, job, rule-source or editor metadata.

Text-model rule edits omit embedded presentation bytes from model context and
preserve server-loaded presentation files exactly. Adding/replacing a back
changes the release manifest and leaves the old automated review stale until
the current bundle passes actual validation and the Lua quality service again.
Background job receipts do not consume editor Undo entries.
Automatic rechecking is queued only for the exact manifest changed by an artwork
attachment. Unrelated rule edits keep their previous review visibly stale;
the creator can request a current check in the artwork dialog. Editing a script
does not launch a quality request on every keystroke.

## Focused verification

`e2e/rasterArt.e2e.ts` uses the existing authored First Deal rules and explicitly
identified local raster HTTP fixtures. The Worker, R2 writes, browser decode,
quality service, private runtime and ordinary publication are real local paths.
The fixture lookup is only in `scripts/e2e-generation-fixture.ts`, never the
production image path. Existing sample pictures in those tests are transport
inputs, **not approved game-specific art**. Blank-image and lost-reply cases
retain separate failure/recovery evidence. See the source-pinned QA receipt for
which checks and original captures actually passed.

Live text/image access, seven external Merlin Sheets, per-deck/custom-front
work, visual acceptance, full-game playtesting and perceptual audio QA remain
separate prerequisites. Saved cloud configuration is not a published rollout.
