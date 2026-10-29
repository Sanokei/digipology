# Crafted cards, decks, dice and source sounds

Application source: **fbc1d4bb8928bd7513af8d82dc8dcdddc2c19fdc** ([commit](https://github.com/Sanokei/digipology/commit/fbc1d4bb8928bd7513af8d82dc8dcdddc2c19fdc)). This QA-only commit directly parents that
application source. It adds review artifacts only; it is not a deployment or a
claim of live model generation. All PNGs are original browser captures.

Start with these original current-source frames:

- [Card front on desktop](visual/current/cards-front-desktop.png) · [phone](visual/current/cards-front-narrow.png)
- [Card back on desktop](visual/current/cards-back-desktop.png) · [phone](visual/current/cards-back-narrow.png)
- [Court inspection](visual/current/queen-court-inspection-desktop.png) · [short phone view](visual/current/queen-court-inspection-narrow.png)
- [Dice and chips](visual/current/dice-desktop.png) · [settled Lite winner on phone](visual/current/lite-winner-narrow.png)
- [Private owner hand](visual/current/cards-private-hand-owner-narrow.png) · [guest view](visual/current/cards-guest-private-desktop.png) · [concealed inspection](visual/current/lite-concealed-card-inspection.png)
- [Offline listening page](listening/listen.html) · [exact masters](audio/v1/clips/) · [originals and provenance](audio/v1/)

`visual/current/` contains all 21 current original frames: full card front/back, deck, private owner/guest hand,
mirrored court inspection, die/chips and settled winner at desktop/390px. The
observations identify the exact source and actual renderer. WebGL and genuine
WebGPU/Lite use Chromium's software graphics; they do not establish hardware
performance. `listening/listen.html` is a portable offline page: download its raw
file and open it locally to play the three exact originals and three masters.
It needs no server, network, credentials or autoplay. The individual audio files
are also under `audio/v1/`.

## Actual change

Shared rounded card stock, complete standard faces/patterned backs, mirrored
illustrated court cards, layered deck edges/counts, six pip faces on standard D6,
numbered chip faces and textured felt/wood replace primitive presentation. Hand
and inspection use the same raster painter. Arbitrary cards/dice retain authored
names/results; concealed models contain only a generic back. Narrow automatic
framing includes visible physical pieces and respects subsequent camera/drag
control. Logical counters without transforms no longer render through pieces.

The real source-to-table sound seam now acquires pinned creator clips with normal
HTTPS Git, verifies source/license hashes, trims/masters them, and pins a bounded
versioned JSON/WAV presentation file through normal editor import, editable backup,
private play, release export, publication, download, guest join and reload. Adding
it changes release integrity/review freshness, never canonical game state or Lua.
Existing editorial artwork/credits/review remain outside the immutable release.

## Validation scopes

- `validation/sound-integration-11cd/`: source
  `11cd877e6fb6c39771cf77562c7199d2cba0ece2`, 150 focused tests across 24 files,
  web/Worker/protocol/scripts/E2E types, build/chunks/frozen guard, five actual
  browser cases, captured child exit 0. The sound tests cover exact asset bytes,
  native decoded waveform correlation, normal editor/publication/guest flow,
  real foreground other-seat draw silence with public positive control, own draw
  playback, mute/gain, fetch503/decode failures, retry and controlled visibility
  recovery without replay. Raw auth-bearing logs/traces remain outside Git.
- `validation/webgl-f72/` and `browser/webgl-f72/`: source
  `f72af1d637e3a112950be58bce5aca5558d4a731`, 111 renderer/hand/First Deal tests,
  web/Worker/E2E types, build/chunks/frozen guard and three actual table browser
  cases with child exit 0. They exercise two-player winner/reload, named private
  cards/draw/play/flip/inspection, short court dialog/Escape focus and mobile
  controls. This source passes WebGL visual review but its actual Lite findings
  are retained separately.
- `validation/current/` and `visual/current/`: final-source renderer-only checks,
  build/chunks/frozen receipt and actual settled renderer captures/probes. Read
  their exact counts, source pins and command exits; do not add repeated test
  counts together or relabel earlier passes as final-source reruns.

The final delta after f72 is confined to Lite rendering and its regression
coverage; unchanged audio/gameplay checks above retain their original source
scope. Pinned releases/replay fixtures, rules and canonical state remain intact.
Presentation privacy is official-client visual/audio privacy, not cryptographic
hidden-information security.

## Retained findings

`visual/before/` uses the 502bd12 renderer with an earlier audio working build,
not an exact full-app main build. `visual/intermediate-ab213/` retains the cropped
card texture, excess glow and initial geometry. `visual/failed-dice-11cd/` retain the actual inward-face die failure despite
passing functional tests. A native Core/Lite builder comparison establishes the
required clockwise winding with outward normals. Later actual Lite failures
(black shadow rectangles/oversized paper planes) are preserved separately from
corrected frames. See per-file `manifest.json` for exact attribution/hashes.
The older bebeab5 tool-exit anomaly remains historical in its unchanged pack.

Early nonfinal failures included a new-output copy EEXIST, legacy release mocks
without files, an out-of-allowlist initial asset path, a Ctrl+S menu exact-match
harness error and overly strict native decoded PCM fingerprinting. Raw file
SHA-256 stays exact. Browser decoding is tested with matching length/rate/energy
and 512-point waveform correlation >0.999, not bit-identical float rounding. A
separate delayed-activation regression failed before the bounded event queue fix.
No assertions were disabled to make gameplay pass.

## Source audio and remaining quality work

Creator: Kenney, official `KenneyNL/Starter-Kit-3D-Platformer` at
`3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0`. Its pinned README explicitly dedicates
sound effects to CC0; the separate MIT code license is retained. Per-file source
URLs, original/processed SHA-256, license evidence hash, exact FFmpeg 7.1.5 recipe,
measurements and toolchain are retained in `audio/v1/`. `land.ogg` becomes a short
placement tap, `walking.ogg` an impact sequence, `coin.ogg` a choice notification.
The coin metadata identifies GameSynth/Tsugi generation; these are adapted game
effects, not live app-generated recordings or established naturalistic Foley.
A second fresh acquisition reproduced all 15 outputs byte-for-byte.

Masters are bounded mono 48kHz PCM16 WAV with complete containers, nonzero signal,
quiet/faded edges and measured peak headroom. Three voices, gesture activation,
persistent gain/mute and lifecycle cleanup are implemented. Other cues have an
explicit simple-tone fallback. Numeric validation, graphs and native playback
starts do not prove pleasant timbre, balance, repetitive comfort or fun. **No
perceptual listening was available in the tools; listening quality remains
pending.** The portable players provide exact audio for that review.

Live prompt-driven custom card art/media selection, 3D model/music integration
and genuine original strategy-game quality remain unfinished. Current generation
requires authorized endpoint/model/key and publishing the saved cloud network
draft; none was provisioned here. Production migration 0008/deployment and observed
unattended Actions credentials/permissions/runs remain pending. No new schedule,
network bypass, secret/provider purchase or production operation was performed.
There is no supported public app preview URL in this environment.

Nonblocking observed follow-up: a desktop mouse-control hint can partly overlap
the 390px toolbar after explicit mouse-context actions. Lite felt/wood remain
darker than WebGL. These are recorded in the current visual notes. A physical
phone/touch-device run, broad hardware performance and subjective fun/listening
are not established by software-device viewport captures.
