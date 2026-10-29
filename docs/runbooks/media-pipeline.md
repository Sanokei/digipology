# Asset discovery and audio processing harness

Run commands from the repository root with Bun, FFmpeg and ffprobe available.
The harness is developer tooling; generation and editor integration are tracked
in the product backlog rather than represented as completed functionality.

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

Automatic asset choice, model conversion, visual consistency checks, packing
assets into immutable releases and generated-game music/effects integration
remain backlog work. The table currently uses bounded synthesized fallback
Foley with gesture activation, mute/level persistence and confirmed-event
deduplication. Those fallback sounds are not described as imported recordings.
