# Per-game artwork: repair, editing and verified handoff

Application **`85e433f0c443331208be53d3c8d4d212938d2bbf`**, based on `af009d58a820fb64d40bc6edbb6946e644feedab`. This QA-only commit directly parents that application source. Every included file has a SHA256/byte count and source scope in `manifest.json`. GitHub main/source refs and exact hosted CI are recorded in `validation/`; no deploy or production migration was performed.

A broken saved cover could be silently replaced by a pending image job on reload, while the new artwork editor dropped manual-save recovery and existing browser acceptance still targeted its superseded dialog. The app now preserves broken selections as a publication-blocking repair task, provides deliberate retry/replace/remove, and keeps credits, editable backup, unsaved pixels and retry through the normal per-game artwork workflow. A storage failure does not claim a save or restart gameplay.

The game-authored direction/separate raster cover/default-back pipeline is already on main from c2f78ea76a4ff2570af01c40c911736bef72db80. Its exact prior QA is [e76a685](https://github.com/Sanokei/digipology/tree/e76a685ad65c829f7a03242fae9dd6c4fac85db4/qa/c2f78ea76a4f-game-directed-artwork). It retains original/processed/prompt hashes, model/time/credits, saved direction and independent image retries; this recovery increment completes manual editing/recovery paths. Unknown created games do not receive borrowed demo art by guessed title.

## Checks and original frames

- Exact current hosted run [40950946771](https://github.com/Sanokei/digipology/actions/runs/40950946771): **success**. The full unit/browser totals and every hosted step are recorded in `validation/hosted-ci-commands.json`.
- Local nine-case affected run:9 expected,0 skipped/unexpected/flaky/errors, child exit0. Final three-case run:3 expected,0 skipped/unexpected/flaky/errors, child exit0; these extend actual deliberate repair/empty-dialog download and close the omitted source transport case. Do not add overlapping test totals.
- 13 affected unit tests plus E2E/web types, current web build, isolated chunks and frozen fixture checks pass. Earlier full940-test run belongs to AF's preceding unit/privacy fix. Its hosted browser24-pass/9-fail receipt and initial two harness failures are retained under `historical/`; none is described as a release pass.

`current/` contains original desktop/390px/short private hand, concealed inspection, court, image storage/repair, credits/publication and focused form captures. `plans/visual-review.md` records actual owner review and limitations. The damaged-cover before image and owner-loading screencast are separately retained; they are failed/transient states. Current settled hand restoration waits for actual renderer readiness and foregrounds the player before reload. Production auth limits are untouched; independent test IPs prevent cross-test quota contamination, and a real same-IP eleventh request still fails429.

## Limits and next usable work

Technical rule/image ports and authored saved raster fixtures exercise real runtime/storage/decode/publication. Their sample/cover-as-back pixels are **not approved final artwork** and do not prove live game/image generation. Actual ordinary8787 APIs remain503 ai_unconfigured/artwork_unconfigured with no authorized text/image endpoint/model/key. No provider was provisioned. Rich custom card fronts, distinct family/deck artwork bindings, live style/coherence and faithful Merlin strategy generation remain unfinished. `plans/next-card-art-gap.md` is an audit and acceptance plan, not an implemented feature.

A current observed UX gap is kept explicit: the PRIVATE DRAFT390px creation/settings toolbar and progress panel obscure central table/die pixels. The current narrow private frame does not establish unobstructed polished mobile play. Public game title/player/Play entry stays visible in the first phone screen; this is a different layout.

All7 real Merlin linked catalogs are now readable and included with the full v0.1.27b rulebook as8 exact private sources/99,651bytes. [Complete source receipt](https://github.com/Sanokei/digipology/tree/b47b8d000ef2e17151746dfb31876304ae94458e/qa/e47ea33ffb3a-merlin-complete-catalogs) records original exports, authorship and unresolved rule/count gaps. Copyrighted full text/workbooks and actual request stay outside this public pack. No generated Merlin game or inferred rule completion is claimed.

## Exact sound listening material

Download this pack preserving paths and open `listening/listen.html` locally. `audio/v1/originals/`, `clips/`, per-clip receipts and `provenance/` retain the exact three Kenney CC0 sources/masters/license/toolchain from unchanged source fbc1d4bb8928bd7513af8d82dc8dcdddc2c19fdc and QAa3f4935f88a87f57f0286b36a9c2cf9185dd5c39. This is an offline listening artifact, not evidence that audio was perceptually heard/reviewed. Current browser playback/credit/bundle checks do not establish fun, listening quality or cryptographic hidden-state secrecy. Other cues remain fallback tones.

The existing scheduled loop actually ran40931504883 and stopped at missing/empty repository Actions OPENAI_API_KEY; no implementation/PR/merge ran. No duplicate schedule or secret was created. App provider settings, production migration0008/deployment and reviewed/published environment snapshot remain separate account/operator prerequisites. Development preview is local127.0.0.1:8787 only; no public app URL is invented. Raw auth/server/debug logs, sessions, traces, full private rule input and the118MiB CI artifact are excluded.
