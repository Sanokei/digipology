import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { MERLIN_CATALOGS, catalogUrl } from "../scripts/benchmarks/merlin-catalogs";
import type { CreateAiGameRequest } from "../packages/protocol/src/http";

const SOURCE = "8bed07f5bfed67b89cf52b5c6ce3baa7bdd97260";
const HASH = "e79d0701f988e78458443e8e2b43b98d334d981baf748b46611074c059ef880b";
const fingerprint = (text: string) => `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

test("the complete pinned Merlin rulebook and seven real catalogs survive normal creation, retry and exact download", async ({ page }, info) => {
  test.setTimeout(120_000);
  const inputDirectory = process.env.MERLIN_ECONOMICS_INPUT;
  if (!inputDirectory) throw new Error("Set MERLIN_ECONOMICS_INPUT to a new complete packet prepared by scripts/benchmarks/merlin-economics.ts with its pinned CSV directory. No source/model substitute is used.");
  const packet = JSON.parse(await readFile(join(inputDirectory, "merlin-economics.request.json"), "utf8")) as CreateAiGameRequest;
  const references = packet.references!;
  expect(references).toHaveLength(8); expect(fingerprint(references[0]!.text)).toBe(`sha256:${HASH}`);
  for (const [index, catalog] of MERLIN_CATALOGS.entries()) {
    const source = references[index + 1]!;
    expect(source.name).toBe(catalog.name); expect(source.sourceUrl).toBe(catalogUrl(catalog.document));
    expect(fingerprint(source.text)).toBe(`sha256:${catalog.sha256}`);
  }
  expect(references.reduce((sum, source) => sum + Buffer.byteLength(source.text, "utf8"), 0)).toBe(99_651);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(`merlin-catalogs-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json();
  await page.goto(link); await page.goto("/create");
  await page.getByLabel("Game description", { exact: true }).fill(packet.prompt);
  const input = page.getByLabel("Attach rule or card files", { exact: true });
  await input.setInputFiles(references.map((source) => ({ name: source.name, mimeType: source.name.endsWith(".csv") ? "text/csv" : "text/markdown", buffer: Buffer.from(source.text, "utf8") })));
  const sources = page.getByRole("list", { name: "Attached source documents", exact: true });
  await expect(sources.locator("li")).toHaveCount(8);
  for (const [index, source] of references.entries()) {
    const row = sources.locator("li").nth(index);
    await row.getByRole("textbox", { name: /Public source URL/ }).fill(source.sourceUrl!);
    await row.getByText("Source fingerprint", { exact: true }).click();
    await expect(row.locator("code")).toHaveText(fingerprint(source.text));
  }
  await page.screenshot({ path: info.outputPath("merlin-eight-sources-desktop.png"), fullPage: true });
  await input.setInputFiles({ name: "Pixels.png", mimeType: "image/png", buffer: Buffer.from("binary") });
  await expect(page.locator(".rule-sources [role=alert]")).toContainText("text, Markdown or CSV");
  await expect(sources.locator("li")).toHaveCount(8);
  await input.setInputFiles({ name: "Ninth.md", mimeType: "text/markdown", buffer: Buffer.from("A ninth source must not replace the complete accepted set.") });
  await expect(page.locator(".rule-sources [role=alert]")).toContainText("at most 8");
  await expect(sources.locator("li")).toHaveCount(8);
  await page.setViewportSize({ width: 390, height: 480 });
  const urlField = sources.locator("li").last().getByRole("textbox", { name: /Public source URL/ });
  await urlField.focus(); await urlField.scrollIntoViewIfNeeded();
  const box = await urlField.boundingBox();
  expect(box?.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath("merlin-eighth-source-short.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  const submitted = page.waitForResponse((response) => response.url().endsWith("/api/ai/games") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(503); expect(await response.json()).toMatchObject({ error: { code: "ai_unconfigured" } });
  const request = response.request().postDataJSON(); expect(request).toEqual(packet);
  await expect(page.locator(".ai-state-unconfigured")).toContainText("isn't set up");
  await expect(page.getByLabel("Game description", { exact: true })).toHaveValue(packet.prompt);
  const retry = page.getByRole("button", { name: "Retry AI draft", exact: true });
  await expect(retry).toBeEnabled(); await retry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("merlin-eight-source-recovery-390.png"), fullPage: false });
  const again = page.waitForResponse((r) => r.url().endsWith("/api/ai/games") && r.request().method() === "POST");
  await retry.click(); const retryResponse = await again;
  expect(retryResponse.status()).toBe(503); expect(retryResponse.request().postDataJSON()).toEqual(packet);
  await retry.focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Download generation request", exact: true })).toBeFocused();
  const downloading = page.waitForEvent("download"); await page.keyboard.press("Enter");
  const requestPath = info.outputPath("merlin-complete-source.request.json"); await (await downloading).saveAs(requestPath);
  expect(JSON.parse(await readFile(requestPath, "utf8"))).toEqual(packet);
  await expect(page).toHaveURL(/\/create$/);
  expect((await (await page.request.get("/api/games/mine")).json()).games).toHaveLength(0); expect(errors).toEqual([]);
  await writeFile(info.outputPath("merlin-attempt-receipt.json"), JSON.stringify({ sourceCommit: SOURCE, rulebookSha256: HASH, sourceBytes: 99_651, sourceCount: 8,
    sources: references.map((source) => ({ name: source.name, sourceUrl: source.sourceUrl, bytes: Buffer.byteLength(source.text, "utf8"), sha256: fingerprint(source.text), fullTextIncluded: true })),
    normalFormAndApiUsed: true, exactSourceTextRetained: true, response: { status: 503, code: "ai_unconfigured" }, retryPreservedRequest: true,
    requestDownloadExact: true, fixtureModelUsed: false, liveGenerationVerified: false, fullMerlinGameAccepted: false,
    scope: "Eight real pinned sources through normal form/API on an intentionally unconfigured isolated server. No provider fixture, generated game, artwork/fun claim or silent count correction." }, null, 2));
});
