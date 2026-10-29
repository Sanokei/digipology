# Merlin Economics: full-source intake and honest failed-generation recovery

Application source `eeb522c004bbad33e1e3aae5a6aaa76cc281a086`. This QA-only commit directly parents that source. Every file has exact source/scope and SHA-256 in manifest.json. The full rulebook and source request text are deliberately excluded from this pack; the user's author-provided original remains pinned in its source repository.

## Verified result

The actual existing onboarding app received the entire pinned **65,874-byte** Merlin Economics v0.1.27b rulebook through normal Chromium sign-in, Create, file selection and API submission. It returned **503 / ai_unconfigured**, preserved the source, and produced **no generated draft**. `actual-app/existing-app-browser-attempt.json` is this real result; it is distinct from an intentionally unconfigured test server and from a fixture provider. No model/provider configuration was installed by that attempt.

Create now supports eight complete Markdown/text/CSV/TSV sources up to128KiB together, keeping the short instruction. It preserves BOM/line endings/trailing spaces and hashes complete text. Binary/damaged/duplicate/over-budget additions fail without replacing accepted files. Optional public URLs record provenance and are not silently fetched. Generation and repair receive the complete source strings plus server-computed hashes. Sources remain editor-only metadata through private play, normal editor saves/reload, generation-request download and editable backup/reimport; release export stays exact and excludes source documents.

## Checks and exact boundaries

- `954993b3fe83b969f46110a5c46d1f17f6fd498b`:66 focused tests across6 files pass, plus web build, Worker/protocol/E2E/scripts types, chunk and immutable-fixture checks. Exact pinned Git-object preparation succeeds with all7 external catalogs recorded.
- `ca8a3c01e9913d381567a48f1b7acbddb0d2bf88` fixes a real inherited form-grid rule that overlapped the new action buttons. The affected web build passes. Its subsequent browser failure was an exact-name test selector missing the existing Ctrl+S shortcut label.
- `2cf3bfa53732abf546bfbdc107a9037ac743c20c` fixes that selector. The next failure was a harness reload before the editor's advertised Saved state; the next test waits for Saved rather than asserting unsaved changes persisted.
- `d9d428b8aff7a3bf338eeae35c9dae459ba3063b`: the successful fixture-provider source→repair→private play→editor/edit→reload→exact source download/backup/reimport case passes, child exit0. Its initial real-source unavailable-provider test got the first503, then a local Wrangler exit1 with an empty error and a retry500. That failure is retained, not called a passing receipt.
- Current `eeb522c004bbad33e1e3aae5a6aaa76cc281a086` consumes/validates bounded input before early configuration responses.35 affected Worker tests pass, Worker types pass, and the real full-rulebook browser case now passes with child exit0: exact source, invalid-file recovery, desktop/390px/short form, unchanged retry/download, no accepted/published substitute. The static web source is unchanged from the successful `ca8a3c01e9913d381567a48f1b7acbddb0d2bf88` build; later changes are Worker input handling and test corrections.

All pass/fail/skipped counts and child exits are in the individual command and browser summaries. No unrelated full860-test/18-case cycle was run. Raw auth-bearing browser/server stdout, traces, cookie/session data and Wrangler debug logs are excluded.

## Still required for a full Merlin game

Pinned source: SidewaysTurtle/MerlinEconomics at8bed07f5bfed67b89cf52b5c6ce3baa7bdd97260, Rulebook.md SHA-256e79d0701f988e78458443e8e2b43b98d334d981baf748b46611074c059ef880b. The user explicitly approved this version with gaps recorded and clarified that the linked Google Sheets are part of the source. All7 catalogs—Golems, Royal Guards, Tea Leaves, Crystal Ball, Spells, Potions and Royal Decrees—remain unread. The ordinary Royal Decrees export received CONNECT403. This does not establish their contents or require invented replacements. `docs.google.com` access is required; saved settings are not publication or proof of runtime access.

The partial repository Cards.sheet and unresolved Taxes/Indicators/Bankruptcy, auction tie/rounding and climate-wheel references are documented in the source-backed plan. The acceptance matrix still requires actual4–6-player Merlin mechanics, cards/decks/dice, economic/combat/season/contract systems and both victories, real generation-to-play/repair, semantic checks, private-hand/replay/recovery and human play/listening review. The successful transport fixture is an existing deterministic dice game and cannot be renamed or counted as Merlin.

## Artwork is explicitly unfinished

The human requires each created game to decide and generate its own coherent cover/card/deck artwork. Reused sample cover pictures remain rejected. The old SVG-only pattern generator and this rules-input checkpoint do not meet that requirement. `plans/next-per-game-raster-seam.md` records primary provider documentation and the next concrete cover/default-back job seam. No image provider was provisioned or invoked by this checkpoint; no bespoke image, full-game, fun or perceptual sound acceptance is inferred.

Prior card/geometry/touch evidence remains pinned at [3584b7a](https://github.com/Sanokei/digipology/tree/3584b7a71227bf48ee9ee5349824ea5f9503b4c2/qa/5b5ba30ad91a-card-stock-backs). Prior sound/listening evidence and the historical two-case tool-exit anomaly remain separately scoped in earlier packs. Provider access, production migration0008/deployment, cloud-draft publication and unattended scheduled Actions remain pending. Local app preview has no supported public URL.
