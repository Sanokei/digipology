/** Prepare the user's real benchmark from pinned Git objects, with no model/network substitute. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { validateCreateAiGameRequest } from "../../packages/protocol/src/http";

const SOURCE = "8bed07f5bfed67b89cf52b5c6ce3baa7bdd97260";
const RULE_PATH = "Merlin Economics Obsidian/Rulebook.md";
const EXPECTED = "e79d0701f988e78458443e8e2b43b98d334d981baf748b46611074c059ef880b";
const [repository, destination] = process.argv.slice(2);
if (!repository || !destination) throw new Error("Usage: bun scripts/benchmarks/merlin-economics.ts LOCAL_MERLIN_REPOSITORY NEW_OUTPUT_DIRECTORY");
const result = Bun.spawnSync(["git", "-C", resolve(repository), "show", `${SOURCE}:${RULE_PATH}`], { stdout: "pipe", stderr: "pipe" });
if (result.exitCode !== 0) throw new Error(`Cannot read pinned Merlin rulebook: ${new TextDecoder().decode(result.stderr)}`);
const bytes = result.stdout;
const hash = createHash("sha256").update(bytes).digest("hex");
if (hash !== EXPECTED) throw new Error(`Pinned rulebook hash mismatch: ${hash}`);
const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const url = `https://github.com/SidewaysTurtle/MerlinEconomics/blob/${SOURCE}/Merlin%20Economics%20Obsidian/Rulebook.md`;
const request = {
  prompt: "Create Merlin Economics v0.1.27b for 4–6 players from the attached complete rulebook. Preserve its economy, private cards, dice production, investments, research, combat, seasons, contracts and both victory conditions. Use readable card fronts, game-specific raster backs, a coherent board and clear legal next actions. The seven linked Google Sheets are required external source material and have not been included in this packet. Record unresolved cards/rules and source gaps explicitly in the player guide; do not invent their definitions or replace this game with a simpler example. An incomplete source/game must remain labelled incomplete for acceptance.",
  references: [{ name: "Merlin Economics v0.1.27b · Rulebook.md", text, sourceUrl: url }],
};
const checked = validateCreateAiGameRequest(request);
if (!checked.ok) throw new Error(`Benchmark request rejected: ${checked.error.message}`);
const catalogs = [...text.matchAll(/\[([^\]]+)\]\((https:\/\/docs\.google\.com\/spreadsheets\/d\/[^)]+)\)/g)]
  .map((match) => ({ name: match[1], sourceUrl: match[2], status: "not included; must be read before complete-game acceptance" }));
if (catalogs.length !== 7) throw new Error(`Expected all seven source catalogs, found ${catalogs.length}`);
const mechanics = [
  "four- and six-player setup, ten starting gold, sealed-bid starting order",
  "two-die production for every eligible player and public resource accounting",
  "properties, permits, investments, seven losses and Chauffeur protection",
  "research success and exact spell/potion catalogs and effects",
  "golem and Royal Guard generation, movement, timing and combat",
  "Royal Decrees, crowns, highest net worth and bankruptcy victory",
  "seasons, forecast cards, commodity transport and climate change",
  "covered order book, escrow, futures expiry/default and insurance",
  "replay/reload integrity and private-hand/hidden-action isolation",
  "readable desktop/phone card/deck/dice art, meaningful audio and usable actions",
];
const output = resolve(destination);
await mkdir(output);
await writeFile(resolve(output, "Rulebook.md"), bytes);
await writeFile(resolve(output, "merlin-economics.request.json"), JSON.stringify(checked.value, null, 2) + "\n");
const receipt = { benchmark: "Merlin Economics", version: "v0.1.27b", repository: "https://github.com/SidewaysTurtle/MerlinEconomics", sourceCommit: SOURCE,
  rights: "Author-provided benchmark; source says All Rights Reserved, SidewaysTurtle / Kei Sano. No CC0 claim.",
  rulebook: { path: RULE_PATH, sourceUrl: url, bytes: bytes.length, characters: text.length, sha256: hash, completeTextIncluded: true },
  stage: "input prepared; generation not attempted by this command", liveGenerationVerified: false, fullGameAccepted: false,
  externalCatalogs: catalogs, acceptance: mechanics.map((behavior) => ({ behavior, status: "pending actual generated-game verification" })),
  sourceQuestions: ["Rulebook references Taxes, Indicators and Bankruptcy sections absent from the repository rulebook; external catalogs remain unread.", "Auction tie/rounding behavior and precise season/climate wheel values require source confirmation.", "Repository Cards.sheet is a partial historical snapshot, not a substitute for unread linked Google Sheets."],
};
await writeFile(resolve(output, "benchmark-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ output, source: SOURCE, rulebookSha256: hash, bytes: bytes.length, linkedCatalogs: catalogs.length, liveGenerationVerified: false }));
