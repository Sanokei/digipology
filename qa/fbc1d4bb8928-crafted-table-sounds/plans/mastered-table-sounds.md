# Source-to-table sound bundle: bounded acceptance plan

Base source: `502bd124d33bb5dc9fd496c00c5774da36e121fd`.
The public-entry checkpoint and its pinned QA pack remain closed and unchanged.

## Actual gap and alternatives

`scripts/media/assets.ts` searches Openverse and records source/creator/license
and original hashes. `scripts/media/audio.ts` trims and normalizes with FFmpeg.
Neither feeds an editor/release/runtime asset. `TableAudio.ts` always calls
`renderCue`; `useTableAudio.ts` maps every confirmed event without a listener
identity. The existing mapper emits `choice` for another player's private prompt
and `card` for a private-card flip. Those before results are retained. The old
roadmap candidate (edited-draft quality recheck) remains independent; the real
sound-and-music backlog is still unfinished and must not be marked complete.

Adding more synthesized presets would miss actual acquisition/mastering.
Adding only global static clips would miss an editable, pinned game handoff.
Introducing separate R2 uploads/database metadata would duplicate existing
immutable release storage and widen this increment unnecessarily. Use a small,
self-contained, versioned presentation file in the normal release file list.
It changes the release manifest/review freshness, never canonical game rules or
state, and naturally survives existing editable backups/import/export/publication.
Editor-only cover/review metadata remains outside the release as before.

## Sources and primary references

Direct normal requests to Kenney's Casino Audio page and MDN were denied with
`Tunnel connection failed: 403 Forbidden`. Existing asset/API denials are not
retried and no proxy/network configuration is changed. Normal HTTPS Git access
to the creator's public repository succeeds through the existing environment.

Use a deliberately small auditable palette from **Kenney**'s official
`KenneyNL/Starter-Kit-3D-Platformer`, pinned at
`3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0`: `sounds/land.ogg`,
`sounds/walking.ogg`, `sounds/coin.ogg`. The pinned README explicitly dedicates
sound effects to CC0; retain it and the repository's separate MIT code license.
Keep each original file, original SHA-256, pinned blob URL, creator and per-file
CC0-1.0/license URL. Adapt short impact/card placement, a sequence of impacts for
dice, and a choice notification. These are adapted game effects; naturalistic
card/dice Foley and perceptual suitability are not established by their names.
The coin source itself identifies GameSynth generation; it is not described as
a live app-generated recording. Exact source hashes are in the acquisition receipt.

Primary references actually read:

- The pinned creator README and LICENSE, obtained with normal Git.
- Installed FFmpeg's own `silenceremove`, `astats`, `loudnorm`, `afade` help:
  preserve interior pauses, measure actual output and handle short transients
  without pretending invalid integrated LUFS is finite.
- W3C Web Audio source `WebAudio/web-audio-api` at
  `337d6cc1bd8269bf4971d3065ca923660bfcca0c`, `index.bs`, decodeAudioData/state
  algorithms. The decoder may recover corrupted compressed data and resamples
  to the context rate. Therefore browser decoding alone is not byte/container
  integrity, completeness or loudness validation; retain independent checks.

## One working path

1. Reusable CLI acquisition from an audited pinned creator manifest, using normal
   HTTPS Git without auth/proxy changes. Verify source and license evidence hashes.
   Master three effect clips with the existing FFmpeg harness. Require full decode,
   nonzero signal, bounded duration, mono 48 kHz PCM16 WAV, quiet edges, finite
   measurements and measured peak headroom; reject silence/clipping/truncation.
   Save original/processed hashes, exact recipe/tool version, measurements and
   provenance. Rebuilding with the recorded toolchain must reproduce exact bytes.
2. Versioned sound-bundle JSON with embedded verified WAV bytes and per-clip
   source/license/processing metadata. Bound count, encoded bytes and duration.
   The standard app palette is available without a model/provider. A creator can
   explicitly import/pin it through the desktop editor; the release asset path
   `runtime/presentation/table-sounds.json` is visible and exported intentionally.
3. Load and verify the bundle into the ordinary private/editor/public table audio
   engine. Use user-gesture activation, persistent mute/gain, bounded voices,
   hidden-tab/disposal cleanup, and visible loading/failure/retry. A failed import
   preserves the prior bundle; failed playback must not interrupt gameplay or
   claim that recorded/imported audio played. Credits and exact downloads remain
   available. A Test sound gesture permits practical audition.
4. Map only confirmed, newly sequenced events visible to the listening player.
   Filter owner/seat containers, nested membership, private prompts and draws;
   fail closed where visibility is uncertain. Evaluate transitions using before
   and after state so unrevealed source/destination activity cannot leak through
   a cue. Pass the actual seat to private/editor/public audio. Replay/reconnect,
   prediction and seat changes must not replay old/private cues. Kernel semantics
   remain unchanged; this is official-client presentation privacy.

## Focused acceptance and evidence

- Real online creator acquisition, pinned source/license evidence, exact original
  bytes/hashes, reproducible masters and portable versioned bundle; hostile/empty/
  silent/clipped/truncated WAV/bundle cases fail before replacing a good import.
- Unit checks for signal/edges/hash/budgets, actual FFmpeg processing and the
  before-discovered private event leakage, including owner-by-seat, nested
  containers, prompt recipient and draw/flip/move transitions.
- Normal editor import with a real saved raster draft, backup/reopen, stale review
  after a presentation-file edit, private play and normal publication. Verify the
  same bundle after reload and a second guest invite, unchanged canonical initial
  state/rule files/artwork and exact pinned audio/credit bytes in the release.
- Browser measurements of actual decoded clip buffers and started sources after
  gesture; no start before activation, muted/hidden/background/replayed/private
  events; gain and mute persistence; decode/fetch failure with visible retry;
  source credits/downloads and keyboard controls at desktop and 390px.
- Run only relevant media/audio/editor/protocol tests, touched types/build/chunk/
  frozen guards and focused browser flows. Do not repeat unrelated full suites.
  Publish before/after captures, command exits, source pins and playable exact
  original/mastered WAV artifacts for listening review.

Perceptual listening, balance and fun remain pending unless an available tool
actually permits listening. Numeric signal checks and source-start counts do not
establish timbre, pleasant repetition or a polished sound mix. Live prompt-driven
media selection, music and provider generation remain separate unfinished work.
No new showcase games, provider purchase, secret, schedule, network workaround,
public deployment or production operation is part of this plan.

An actual backup round-trip found that the initial `presentation/` proposal was
outside the existing protocol's `runtime/` and `scripts/` path allowlist. The
final path uses the existing `runtime/presentation/` namespace instead of
widening admission. The failed round-trip is retained; no validation was disabled.
