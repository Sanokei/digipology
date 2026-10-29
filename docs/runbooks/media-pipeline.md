# Asset discovery and audio processing harness

Run commands from the repository root with Bun, FFmpeg and ffprobe available.
The harness includes a bounded source-to-table effects path described below.
Automatic themed selection during live generation, music integration and broader
media orchestration remain unfinished product backlog work.

## Versioned table effects through the editor and runtime

```bash
bun scripts/media.ts build-table-sounds scripts/media/table-sounds.sources.json /tmp/table-effects-v1
```

This command acquires three audited CC0 effects from Kenney's official public
Git repository at the manifest's exact commit, using normal HTTPS Git. It verifies
every original and license-evidence SHA-256 before processing. A third positional
argument can reuse an already acquired Git cache; its origin and pinned blobs are
still verified and the acquisition receipt explicitly labels cache reuse. No
credentials/proxy settings are changed, and failures are not replaced with fake
imports. The direct Kenney website/asset API access remains separately restricted
in the current cloud environment; success here establishes the normal Git path.

The output has exact `originals/`, mastered PCM16 mono 48 kHz `clips/`, per-clip
reports, original license/readme evidence, full FFmpeg/ffprobe toolchain record and
a portable `bundle.json`. Its three cues adapt short impacts and a notification;
their timbre and suitability need listening review. They are not represented as
naturalistic casino recordings or live app generation. Two fresh acquisitions with
the recorded toolchain reproduced all 15 output files byte for byte.

The bundled app default lives at `apps/web/public/audio/table-effects/v1/`.
Published versions must keep their exact bytes; change the manifest version and
use a new directory for future palettes. A creator can use **File → Add sound
bundle…** in the desktop editor to inspect credits, audition and explicitly pin
the JSON. It becomes `runtime/presentation/table-sounds.json` in the ordinary
immutable release file list. Existing editable backup/import, release export,
private play and normal publication carry that asset without extra storage or
database schema. Release export intentionally includes the pinned presentation
file, while editor-only cover/review metadata remains outside the release.
The release manifest changes and marks the old review stale; gameplay state and
rules remain unchanged. A combined 1 MiB release budget is checked before import.

The three imported cues are card placement, dice impacts and a choice notice;
other cues retain explicitly described simple tones. Table Sound settings expose
source/CC0 credits, per-cue audition, exact bundle download, persistent mute/gain
and loading/failure/retry. Runtime waits for a gesture, validates full WAV
containers/signals/hashes and actual browser decoding, bounds voice gain/count,
stops voices on mute/seat change/background/disposal and does not replay missed
events on tab return. Newly confirmed cues are filtered through before/after
owner/seat/container visibility and prompt recipients. This is presentation
privacy in the official client, not cryptographic secrecy.

See [the source-backed audit and acceptance plan](mastered-table-sounds.md).
These source fixtures and real processing/browser checks do not establish live
prompt-driven creative selection, perceptual sound quality or fun.

## Search and provenance

```bash
bun scripts/media.ts search-models "wooden table"
bun scripts/media.ts model-files ASSET_ID
bun scripts/media.ts search-audio "wooden dice roll" > /tmp/dice-audio.json
bun scripts/media.ts fetch-asset /tmp/dice-audio.json ASSET_ID /tmp/dice-source.ogg
```

Model discovery uses the Poly Haven public API. Its assets are CC0; API results
include the required "Powered by Poly Haven" credit. Audio discovery uses
Openverse and retains original source, creator, license, license URL and
attribution. The search allows CC0, CC BY and CC BY-SA records; preserve and
follow the selected asset's actual terms when publishing a derivative.

Downloads are bounded, follow only supported HTTPS hosts, validate actual
audio decoding or model admission checks, and write a SHA-256 provenance report
beside the file. Unsupported download hosts and provider failures remain
explicit errors. Never silently invent a replacement asset and call the import
successful.

The current supported download hosts are `dl.polyhaven.org`, `freesound.org`,
`cdn.freesound.org`, and `upload.wikimedia.org`. Search requires
`api.polyhaven.com` and `api.openverse.org`. Cloud environment network policy
must allow these destinations. Additional audio sources need an explicit
provider adapter and their actual destination configured.

## Master effects and music

```bash
bun scripts/media.ts master-audio /tmp/dice-source.ogg /tmp/dice-master.ogg effect
bun scripts/media.ts master-audio /tmp/music-source.wav /tmp/music-master.opus music --loop
```

The processor removes leading/trailing silence, decodes to 48 kHz PCM, measures
loudness and performs a second normalization pass. Effects target -20 LUFS;
background music targets -24 LUFS. Very short transients use measured RMS and
peak gain instead of invalid integrated loudness measurements. Outputs retain
at least 1.5 dB of peak headroom and include fades; loop mode uses 50 ms seam
fades to prevent abrupt clicks. This does not infer tempo or create a musical
arrangement or beat-matched loop.

WAV, Ogg Vorbis and Opus outputs are supported. Processing reports contain
input/output duration, channels, sample rate, measured normalization method
and source/output hashes. Existing masters and reports are not overwritten.
Tests run real FFmpeg processing and decode the result to check output and
peak headroom. Human listening is still required for timbre, timing, balance,
repetition and musical suitability.

## Model admission

```bash
bun scripts/media.ts inspect-glb /tmp/model.glb
bun scripts/media.ts import-glb /tmp/model.glb /tmp/admitted-model.glb
```

These commands check GLB headers, file/triangle budgets and embedded-resource
requirements and save a hash report. The current limit is 16 MiB and 100,000
triangles. They do not replace complete glTF validation, geometry optimization,
scale/orientation normalization or an actual rendering test. Poly Haven files
that need GLTF/FBX/Blender conversion must be processed before GLB admission.

Automatic themed asset choice, model conversion, visual consistency checks,
general asset packing and generated-game music orchestration remain backlog work.
The bounded effects path above does not complete those milestones. Simple fallback
tones are still used for unavailable or unassigned cues and are labeled separately
from the imported creator effects.
