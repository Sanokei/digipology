# Desktop editor artwork handoff

Exact reviewed source: [fd26a3e9993a556232be3fb33af54f5bbaa07a53](https://github.com/Sanokei/digipology/commit/fd26a3e9993a556232be3fb33af54f5bbaa07a53).
This QA-only branch changes no app source. All passing frames/files below are
unchanged outputs from the **same current-source full run**. [evidence.json](evidence.json)
records source refs, original paths, dimensions, SHA-256 hashes and assertions.

**860 tests / 117 files**, full types, production web/site builds, 17 site pages and
internal links, renderer chunk isolation and frozen replay guard pass. The fresh
full browser run passes **all 18 scenarios** with explicitly captured child exit **0**,
0 unexpected/flaky cases and no reporter errors: [command receipt](browser-command.json).
No remote CI result or deployment is claimed.

## Real saved file → desktop edit → private review → publication

The actual prior source-pinned raster draft is reused in e2e/fixtures. A user imports
it through **File → Import draft or bundle**, changes the Lua scoring rule through
the real CodeMirror editor and edits title/description. This is a regression of the
existing dice draft, not another showcase/catalog game or genuine model generation.
The editor flow makes **zero model requests**.

[Edited rule](edited-rule.lua) · [Gameplay release export](edited.release.json) ·
[Editable backup](edited.editor.json) · [Reopened editable backup](reopened.editor.json)

The exported rule awards actual die value + 1; browser assertions verify that score
in **both private and published runtimes**, including publication reload. The release
export contains gameplay only. Editable backup preserves image/credits, description
and the original review. Its new manifest differs from the old automated-review hash:
the UI correctly requests **Review your changes**, without claiming a fresh automated
pass. Publication uses the same owned path and does not put artwork/review metadata
into release or canonical gameplay state.

[Storage recovery desktop](storage-recovery-desktop.png) ·
[Storage recovery 390px](storage-recovery-390.png) ·
[Edited private play 390px](edited-private-play-390.png) ·
[Stale review desktop](stale-review-desktop.png)

The save failure keeps current edits in memory. Keyboard Tab reaches retry/download,
wraps inside the dialog, Escape restores the visible Publish action, and retry saves
the latest snapshot before leaving. An already-open desktop editor stays mounted when
the window narrows, so the recovery session survives a resize; fresh mobile editor
entry remains gated. The downloaded editable backup is reimported through the actual
desktop File action and reopened as a private draft with all metadata intact.

[Artwork publication retry](artwork-publication-retry.png) ·
[Published desktop](published-desktop.png) · [Published 390px](published-390.png) ·
[Published artwork download](published.artwork.json)

An injected upload failure is followed by an **actual server commit with a lost reply**.
**Retry artwork publication** finishes with one game and cover version 1. Actual bytes,
credit metadata and hashes match after reload/download. A later explicit credit edit
creates version 2; version 1 image/credits remain exact and release bytes stay unchanged.
Public artwork packages omit the private local filename; editable backups retain it.

## Focused source field and real codec recovery

[Desktop focused field](source-field-desktop.png) ·
[390×844 focused field](source-field-390x844.png) ·
[390×480 focused field](source-field-390x480.png) ·
[Decode failure/recovery at short height](decode-recovery-390x480.png)

The form has its own bounded scroll area and padded opaque footer. Keyboard focus
reveals the **whole** Public source page input, and resizing keeps it above the footer.
Tests measure full field/body/footer bounds and check hit targets at sampled corners.
Close/save actions remain in the viewport. The negative upload has a valid PNG container
and repaired CRC but invalid compressed pixel data: the real browser decoder rejects
it, retains the prior image, and accepts a later valid image. These are fixture-dependent
format/UX checks, not image-provider or online-sourcing claims.

## Retained failures and current regressions

[Before: resize discarded workspace](before-resize-discarded-workspace.png) ·
[Before: focused source clipped](before-focused-source-clipped.png)

Those failures came from earlier uncommitted builds based on e607e2f; they are clearly
marked as failures, not current-source passes. One earlier editor test also waited on
an exact menu name that omitted its visible Ctrl+S hint; its scoped selector was fixed
without changing product behavior. Exact failed logs/traces remain outside the repo
because raw authentication traces are unsuitable for source sharing.

[Current settled winner desktop](settled-winner-desktop.png) ·
[Current settled winner 390px](settled-winner-390.png) ·
[Current guest-hand view](guest-hand-desktop.png) ·
[Current recovered renderer/hand](renderer-recovered-desktop.png)

These await actual renderer readiness and keep the loading overlay hidden. Privacy
is official-client presentation privacy; shared deterministic state is not cryptographic
hidden-information security. Gameplay/audio/transport evidence comes from the tests;
screenshots do not prove sound quality, balance or fun.

The [earlier pack](https://github.com/Sanokei/digipology/tree/bebeab5405e0b85e3697cd25ccbf190591663109/qa/e607e2f4c528-raster-covers)
is unchanged. Its source-by-frame scopes and two-case tool-exit anomaly remain explicit.
This new full 18-case child exit 0 is fresh evidence, not a reinterpretation of that run.

## Operational boundary

Native Git pushes and normal main integration are verified in the private release
receipt. Known API CONNECT denials were not retried or bypassed. No new providers,
secrets, scheduled jobs or production operations were performed. Production migration
0008, saved cloud-draft publication, live endpoint/model/key and scheduled Actions
key/permissions/execution remain pending/unverified. Genuine strategy generation,
external model/audio/music integration and human fun review remain unfinished.

No supported public preview exposure tool exists here. Local previews are
http://127.0.0.1:8787, http://localhost:5173 and docs http://127.0.0.1:4321.
