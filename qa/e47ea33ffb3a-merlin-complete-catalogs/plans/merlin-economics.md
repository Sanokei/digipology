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

Normal HTTPS Git access retrieved this source. The earlier ordinary Royal
Decrees export failed with CONNECT403; that was an access restriction, not
evidence about its contents. After a fresh environment and a changed network
draft, the same original URL returned200 on 2026-10-29. All seven original
complete-workbook XLSX downloads and CSV exports now return200. Every workbook
has one worksheet, so its original first-sheet CSV covers its tabular data.
No alternate-host/proxy workaround or new account was used. This observed access
does not by itself prove which environment draft was published.

The captured CSV bytes are pinned in
[`scripts/benchmarks/merlin-catalogs.ts`](../../scripts/benchmarks/merlin-catalogs.ts).
They total33,777 bytes; with the rulebook the complete eight-document packet is
**99,651 bytes**, within the existing128KiB input. Source contents stay outside
the checkout/public QA; hashes, original links and analysis are shareable receipts.

| Original catalog | Definitions | Declared copies | Listed copies |
| --- | ---: | ---: | ---: |
| Golems | 8 | Not declared as a total | Not inferred |
| Royal Guards | 4 | Not declared as a total | Not inferred |
| Tea Leaves | 12 | 30 | **42** |
| Crystal Ball | 26 | 51 | **52** |
| Spells | 17 | 62 | 62 |
| Potions | 7 | 28 | 28 |
| Royal Decrees | 14 | Not declared as a total | Not inferred |

These are source findings, not silent corrections. Crystal Ball's XLSX A2
formula is `SUM(A$4:A$999)`, excluding the first listed card at A3. Tea Leaves'
declared30 remains30 in the raw source despite42 listed copies. Spells retains
the zero-copy Transmutation definition. Potions retains all526 CSV records,
including trailing/ingredient data, rather than extracting just seven card rows.
Original Sheets are editable and have no asserted Git revision; the captured
2026-10-29 hashes identify this exact input. A changed export must be inspected
and deliberately repinned instead of silently entering the benchmark.

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

Use a local checkout containing the exact source commit and the seven captured
CSV exports named `golems.csv`, `royal-guards.csv`, `tea-leaves.csv`,
`crystal-ball.csv`, `spells.csv`, `potions.csv` and `royal-decrees.csv` in another
directory. Export through each original `docs.google.com/spreadsheets/d/ID/export?format=csv`
URL in the manifest. The script reads the pinned Git object, checks every CSV's
byte length/hash, analyzes complete quoted/multiline CSV and writes a new packet:

```bash
bun scripts/benchmarks/merlin-economics.ts /path/to/MerlinEconomics /tmp/merlin-input /path/to/pinned-csvs
```

It produces the exact rulebook/seven CSVs, a normal
`merlin-economics.request.json` with all eight references and an acceptance receipt
that reports the unresolved count/rule gaps. Missing or changed catalogs fail
before packet output. The legacy two-argument command deliberately prepares a
rules-only packet marked incomplete; the complete browser benchmark refuses it.
Preparation does not invoke a provider or generate a game. Keep all author-owned
source/request outputs outside the application checkout and public QA packs.

After building the web app, run the explicit real-source browser benchmark:

```bash
MERLIN_ECONOMICS_INPUT=/tmp/merlin-input E2E_SKIP_BUILD=1 \
  bun x playwright test --config e2e/merlin.config.ts
```

This dedicated test uses the normal UI/API with an intentionally unconfigured
isolated server. It verifies all eight pinned sources, invalid/ninth-file atomic
recovery, desktop/390px/short controls, the actual `ai_unconfigured` response,
identical retry and keyboard request download, and no accepted/published
substitute. It has its own match pattern and does not skip or substitute a fixture
when real input is missing. The separate actual normal-app attempt records its
own provider result; an isolated configuration test is not evidence of live access.

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
Ball definition with count zero. It is a partial historical snapshot; the linked
catalogs above contain substantially more data. Those catalog effects do not
replace missing general Taxes, Indicators and Bankruptcy sections. Auction
ties/rounding and exact climate/wheel values still need confirmation. Several
Crystal Ball triggers/bonuses use placeholders such as “specific threshold”,
“a certain amount” and “for example”; these are not exact executable rules.
Retain these gaps and conflicting totals in the player guide rather than inventing
values. Complete document intake is not source completeness or rules fidelity.

An existing source-bearing dice fixture, a structurally valid bundle, a renamed
game, or a scripted random playthrough cannot count as Merlin acceptance. Live
text/image provider access, resolved source ambiguities, generated-game semantic
tests and real play/listening review remain prerequisites. Automated counts do
not establish faithful rules, polished art, balance, perceptual sound quality or
fun. Reused cover pictures and the old geometric SVG generator remain below the
human's per-created-game artwork requirement.
