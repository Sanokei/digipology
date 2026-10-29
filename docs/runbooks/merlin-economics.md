# Merlin Economics source-to-game benchmark

The human selected their Merlin Economics as the real end-to-end target and
authorized using v0.1.27b with unresolved sources/rules recorded. The seven Google
Sheets linked by the rulebook are part of that target. A partial repository copy
does not establish that those external sheets are missing or empty.

Source repository: https://github.com/SidewaysTurtle/MerlinEconomics

- Exact source commit: `8bed07f5bfed67b89cf52b5c6ce3baa7bdd97260`.
- Rulebook: `Merlin Economics Obsidian/Rulebook.md`, 65,874 UTF-8 bytes.
- Rulebook SHA-256: `e79d0701f988e78458443e8e2b43b98d334d981baf748b46611074c059ef880b`.
- Source credits SidewaysTurtle / Kei Sano and says All Rights Reserved. Do not
  relabel it CC0 or put the entire rulebook in the application's distribution.

Normal HTTPS Git access retrieved this source. A normal public CSV export of
the linked Royal Decrees sheet failed with `Tunnel connection failed: 403
Forbidden` in the onboarding environment. No connected Sheets tool is available.
That is an access restriction, not evidence about the sheet's contents. The cloud
allowlist needs `docs.google.com`; saving that request is not publication or
proof the destination is now reachable. Do not retry an unchanged denial or use
another host/proxy to bypass it.

## Source intake and alternatives

The old 8,000-character description and 64 KiB request limit could not accept the
complete rulebook. Summarizing it would change the benchmark. Making the normal
description enormous would mix instructions with source documents. Server-side
fetching of arbitrary URLs would add a separate retrieval/authentication problem.

Create now accepts up to eight complete text/Markdown/CSV/TSV sources, bounded to
128 KiB of combined UTF-8 text. Keep a concise instruction alongside them. The
file picker preserves BOM, line endings and trailing spaces; damaged, binary,
duplicate and over-budget additions fail atomically. Each document shows its
exact hash and an optional public source URL. URLs record provenance; the app
does not silently fetch them. Exported Google Sheets CSV files can be attached
through the same ordinary input.

Generation and repair receive complete source strings and server-computed
hashes as user data. A provider context limit still causes an explicit provider
failure; no source is silently truncated. The HTTP body remains bounded to 1 MiB
to allow JSON escaping. Request validation, authentication, rate and usage caps
still apply.

Sources remain in the accepted draft's editor-only `generationRequest` metadata,
normal browser saves and editable backups. File → Download generation request
retrieves them after editing or reimport. Release-bundle export keeps the exact
playable payload and does not inject original source documents into a public
release. Source metadata is not canonical game state or an automated rules-
fidelity approval. A changed game must still be reviewed and tested.

Before model execution or after failure, **Download generation request** keeps a
portable normal API request. A failed provider preserves the same source set and
instruction, opens no accepted game and offers retry. Storage recovery after a
successful response keeps the accepted source-bearing editable draft.

## Reproduce the bounded source test

Use a local checkout containing the exact source commit above. This command reads
the pinned Git object, verifies its hash, and writes into a new directory:

```bash
bun scripts/benchmarks/merlin-economics.ts /path/to/MerlinEconomics /tmp/merlin-input
```

It produces the exact rulebook, a normal `merlin-economics.request.json` and an
acceptance receipt with all seven linked catalogs marked unread. Preparation
does not invoke a provider or generate a game. Keep these author-provided source
outputs outside the application checkout and public QA packs.

After building the web app, run the explicit real-source browser benchmark:

```bash
MERLIN_ECONOMICS_SOURCE=/path/to/MerlinEconomics E2E_SKIP_BUILD=1 \
  bun x playwright test --config e2e/merlin.config.ts
```

This dedicated test uses the normal UI/API with an intentionally unconfigured
isolated server. It verifies the whole pinned source, invalid-file recovery,
desktop/390px/short controls, an actual `ai_unconfigured` response, identical retry
and request download, and no accepted/published substitute. It has its own match
pattern and does not silently skip or replace missing external input.

`e2e/ruleSources.e2e.ts` separately uses the existing deterministic dice provider
fixture to exercise successful creation/repair, private play, editing, exact
source download and editable-backup reimport. It verifies transport and metadata
persistence only. It is not Merlin, live generation or an artwork-quality pass.

## Full-game acceptance is still pending

The generated game must support 4–6 players and preserve the actual source's:

- Ten starting gold, sealed-bid starting order, two-die production for eligible
  players, properties, permits, investments, seven losses and protected vaults.
- Research, exact spell/potion/forecast/decree catalogs, golems/guards, legal
  movement and combat timing, seasons/climate and commodity transport.
- Covered markets, escrow, futures/default, insurance and both crown/net-worth
  and bankruptcy victories.
- Deterministic replay/reload and appropriate official-client private-hand and
  hidden-action presentation.
- Coherent game-created raster artwork: readable card fronts, purpose-designed
  deck backs, cover, board and dice, with meaningful sound and usable touch UI.

The repository `Cards.sheet` contains seven potion definitions / 28 copies,
thirteen spell definitions / 48 copies, no Tea Leaves definitions and one Crystal
Ball definition with count zero. Treat it as a partial snapshot, never a silent
substitute for the unread external catalogs. The rulebook's Taxes, Indicators
and Bankruptcy cross-references, auction ties/rounding and exact climate/wheel
values need source confirmation. Record resolved versus unresolved items.

An existing source-bearing dice fixture, a structurally valid bundle, a renamed
game, or a scripted random playthrough cannot count as Merlin acceptance. Live
text/image provider access, the seven external catalogs, generated-game semantic
tests and real play/listening review remain prerequisites. Automated counts do
not establish faithful rules, polished art, balance, perceptual sound quality or
fun. Reused cover pictures and the old geometric SVG generator remain below the
human's per-created-game artwork requirement.
