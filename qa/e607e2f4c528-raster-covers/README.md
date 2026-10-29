# Raster cover handoff review pack

Exact reviewed app source: [e607e2f4c5286a0635552bf4463c1075535dec24](https://github.com/Sanokei/digipology/commit/e607e2f4c5286a0635552bf4463c1075535dec24).
This QA-only commit changes no app source. Images are unchanged browser captures.
[evidence.json](evidence.json) records original paths, dimensions, SHA-256 hashes,
metadata, test counts and evidence boundaries.

The substantive artwork release, **e453fd466d60268ad357da6eaf72754a6be91479**, passed **859 tests / 117 files**, full types, production web/site builds, 17 site pages/internal links, renderer chunk isolation, frozen replay guard and **all 16 real browser scenarios**. The final visible-alert follow-up at the exact current source above also passed all 859 tests, full types, a fresh production web build and **both rebuilt artwork browser scenarios**, including an in-viewport damaged-backup alert assertion. The source of each unchanged capture is explicit in evidence.json: current-source artwork frames and e453fd4 table/winner frames. Push/ref verification is recorded in the receipt. No remote CI result or deployment is claimed.

## Settled actual play

[Desktop winner](settled-winner-desktop.png) · [390×844 winner](settled-winner-narrow.png)

Both await renderer readiness and a hidden loading overlay. The winner/status and
scores are readable in the HUD. Empty hands no longer have a Sort control, and the
redundant tiny projected status was removed. The older pack's desktop private-play
image has a transient loading overlay and must not be called a settled table pass.

[Private-hand view](guest-hand-desktop.png) · [Recovered renderer/hand](table-recovered-desktop.png)

These are official-client presentation checks. Shared deterministic state is not
cryptographic hidden-information security. Interactive audio/gameplay/transport
assertions come from the browser tests; screenshots do not establish sound quality
or that a game is fun.

## Local raster handoff

[Private desktop](private-artwork-desktop.png) · [Private 390px](private-artwork-narrow.png) ·
[Artwork editor 390px](artwork-dialog-narrow.png)

[Published desktop](published-artwork-desktop.png) · [Published narrow](published-artwork-narrow.png)

Actual local decode/edit uses an existing original repository illustration with
an explicit transparent-corner test edit. The app prepares a 768×1152 portrait WebP,
checks real encoded MIME/hash/byte limits, and composites alpha onto cream. Browser
pixel checks verify the matte. Artist, usage note and HTTPS source persist through
an ordinary [saved editor draft](accepted-draft.editor.json), private play, owned
publication, reload and [download with credits](published.artwork.json). The public
artwork package omits the original local filename. Saving artwork preserves scores;
artwork metadata stays outside immutable releases and canonical gameplay.

The accepted draft deliberately retains its authored tagline and automated warning
about an unobserved winner in the longer sampled game. Its canned fixture is **not**
evidence of genuine prompt-to-strategy generation. The separate winner frames use
the normal short dice fixture. No new showcase game or online asset is represented.

## Failure and recovery

[Publication retry](publication-retry-desktop.png) · [Missing image](missing-image-desktop.png) ·
[Recovered decoded image](recovered-image-desktop.png) · [Damaged backup](corrupt-backup-narrow.png)

The tests exercise failed replacement, browser quota/download recovery, a controlled
HTTP upload failure followed by retry of the same published game, old-version byte
stability, actual missing-image recovery and saved-artwork reimport. Damaged artwork
becomes a visible replace/remove task and cannot silently publish. Backend tests use
actual SQLite transactions and R2 failure injection to verify pointer/history rollback,
idempotence, attribution history and legacy migration preservation.

Retained earlier failures: [mobile header overflow](before-header-overflow.png) and
[credits lost during decode](before-credit-loss.png). These came from earlier
uncommitted builds based on 194dbac and are **not** final-source passes. The credit
race is fixed: raw image preparation never restores stale credit fields. Two existing
mobile tests now await the actual ResizeObserver no-overlap condition before capture.
Raw traces/authentication logs remain outside the repository. [Earlier hidden alert](before-hidden-alert-narrow.png) is pinned to e453fd4. Final recovery messages stay above the scrolling form, with close/save/remove/download actions visible. The first follow-up attempt passed its complete artwork flow, then the isolated Wrangler CLI exited 1 with a blank error before the second case. That run was stopped after inspecting the recorded processes (workerd children were already defunct, no listening test port). One fresh supported run passed both cases; the exact failed log remains in the private receipt. No source change or network bypass was used for that retry.

## Operational boundary

Apply **D1 migration 0008** on production before enabling new uploads. It is applied
locally. Existing current legacy covers remain readable during rollout; lost old
versions cannot be reconstructed. Native Git source sharing works; unchanged API
CONNECT denials were not retried or bypassed.

Local previews: http://127.0.0.1:8787, http://localhost:5173, docs
http://127.0.0.1:4321. This environment has no supported public preview exposure tool.
The saved cloud network configuration still requires publication; live provider
endpoint/model/key are absent, and scheduled Actions execution is unverified. No new
jobs/secrets/providers were provisioned. Integrated models/audio/music, genuine
creative generation, balance and human fun review remain unfinished.

Next observed local gap: the desktop editor's File→Publish/export alternative still
hands off release bundles. Carry optional editor/artwork metadata through that path
before expanding media types. The directly tested private-play publication and backup
path above is complete.

Earlier creation/review/recovery pack, unchanged:
[baa8f65180733f4bd1c7623dbbee143a4d904828](https://github.com/Sanokei/digipology/tree/baa8f65180733f4bd1c7623dbbee143a4d904828/qa/194dbac-creator-handoff).
