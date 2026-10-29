import { test, expect, type Page } from "./fixtures";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator(".table-render-status")).toHaveCount(0);
}
async function create(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(`artwork-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json() as { link: string };
  await page.goto(link); await page.goto("/create");
  await page.getByLabel("Game description", { exact: true }).fill("[review-warning] Exercise local artwork handoff on a validated fixture draft.");
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  await expect(page).toHaveURL(/\/playtest\//); await ready(page);
}
async function replaceCover(page: Page) {
  await page.getByRole("button", { name: "Edit artwork", exact: true }).click();
  await page.locator('.game-art-asset[data-art-purpose="cover"]').getByRole("button", { name: "Replace image…", exact: true }).click();
  return page.locator(".artwork-dialog");
}
async function closeArt(page: Page) {
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function importDraft(page: Page, json: string) {
  await page.goto("/create");
  await page.locator("summary").filter({ hasText: "Upload an existing game" }).click();
  await page.getByLabel("Game JSON file", { exact: true }).setInputFiles({ name: "artwork-draft.editor.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await expect(page).toHaveURL(/\/playtest\//); await ready(page);
}

test("local alpha artwork survives private play, backup, owned publication, versioned reload and credit download", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await create(page);
  const progress = page.getByRole("complementary", { name: "Game progress", exact: true });
  const oldStatus = await progress.getByRole("status").innerText();
  await page.getByRole("button", { name: "Roll Die", exact: true }).click();
  await expect(progress.getByRole("status")).not.toHaveText(oldStatus);
  const scores = await progress.locator("li strong").allTextContents();
  const dialog = await replaceCover(page);
  // Actual existing raster illustration with an explicitly transparent corner.
  // Canvas only constructs this test upload; the app performs its own real edit/decode.
  const alpha = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch("/art/first-deal.webp")).blob());
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0); bitmap.close(); context.clearRect(0, 0, 100, 100);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await dialog.getByLabel("Image or saved artwork", { exact: true }).setInputFiles({ name: "alpha-local-fixture.png", mimeType: "image/png", buffer: Buffer.from(alpha, "base64") });
  await expect(dialog.getByRole("img")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save artwork", exact: true })).toBeEnabled();
  await dialog.getByLabel("Artist / credit", { exact: true }).fill("Digipology · local QA fixture");
  await dialog.getByLabel("License / usage note", { exact: true }).fill("Original repository illustration, alpha test edit");
  await dialog.getByLabel("Public source page", { exact: true }).fill("https://github.com/Sanokei/digipology/tree/194dbac54647c4474d3ab11934843cbf30356fd0/apps/web/public/art");
  const goodPreview = await dialog.getByRole("img").getAttribute("src");
  await dialog.getByLabel("Image or saved artwork", { exact: true }).setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
  await expect(dialog.getByRole("alert")).toContainText("complete PNG");
  expect(await dialog.getByRole("img").getAttribute("src")).toBe(goodPreview);
  await page.screenshot({ path: testInfo.outputPath("artwork-failed-replacement-desktop.png"), fullPage: true });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restoreStorage(): void }).restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith("dgp.editor.draft.")) throw new DOMException("Quota", "QuotaExceededError"); original.call(this, key, value); };
  });
  await dialog.getByRole("button", { name: "Save artwork", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Download the draft");
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download draft", exact: true }).click();
  const backupPath = testInfo.outputPath("artwork-draft.editor.json");
  await (await downloading).saveAs(backupPath);
  const backupText = await readFile(backupPath, "utf8"), backup = JSON.parse(backupText);
  expect(backup.artwork.info).toMatchObject({ contentType: "image/webp", width: 768, height: 1152 });
  expect(backup.artwork.info.credits.artist).toBe("Digipology · local QA fixture");
  expect(backup.generationReview.warnings.length).toBeGreaterThan(0);
  expect(backup.tagline).toBe("A longer dice race for a test playthrough.");
  const pixels = await page.evaluate(async (dataUrl: string) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return Array.from(ctx.getImageData(10, 10, 1, 1).data);
  }, backup.artwork.dataUrl);
  expect(pixels[3]).toBe(255);
  [250, 247, 238].forEach((value, index) => expect(Math.abs(pixels[index]! - value)).toBeLessThanOrEqual(5));
  await page.evaluate(() => (window as unknown as { restoreStorage(): void }).restoreStorage());
  await dialog.getByRole("button", { name: "Save artwork", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await closeArt(page);
  await expect(progress.locator("li strong")).toHaveText(scores); // Saving artwork does not restart the game.
  await ready(page);
  await page.screenshot({ path: testInfo.outputPath("artwork-private-play-desktop.png"), fullPage: true });
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("dgp.editor.draft.")) localStorage.removeItem(key); });
  await importDraft(page, backupText);
  await expect(page.getByRole("button", { name: "Review playtest", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Dice Dash cover", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(progress.getByRole("status")).toBeInViewport();
  await expect(page.getByRole("combobox", { name: "Sort", exact: true })).toHaveCount(0);
  await replaceCover(page);
  await expect(dialog.getByLabel("Artist / credit", { exact: true })).toHaveValue("Digipology · local QA fixture");
  for (const name of ["Save artwork", "Remove artwork", "Download draft"]) {
    await expect(dialog.getByRole("button", { name, exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: testInfo.outputPath("artwork-restored-editor-narrow.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await closeArt(page);
  await page.screenshot({ path: testInfo.outputPath("artwork-private-play-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.route("**/api/games/*/cover", async (route) => { if (route.request().method() === "POST") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "cover_storage_unavailable", message: "Controlled upload failure" } }) }); else await route.continue(); });
  await page.getByRole("button", { name: "Publish & invite", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("artwork could not be saved");
  await page.screenshot({ path: testInfo.outputPath("artwork-publication-recovery-desktop.png"), fullPage: true });
  await page.unroute("**/api/games/*/cover");
  await page.getByRole("button", { name: "Retry artwork publication", exact: true }).click();
  await expect(page).toHaveURL(/\/table\//); await ready(page);
  const library = await (await page.request.get("/api/games/mine")).json() as { games: Array<{ slug: string; coverVersion: number; tagline: string }> };
  expect(library.games).toHaveLength(1);
  const game = library.games[0]!; expect(game.coverVersion).toBe(1); expect(game.tagline).toBe(backup.tagline);
  const v1 = await (await page.request.get(`/api/games/${game.slug}/cover?v=1`)).body();
  expect(`sha256:${createHash("sha256").update(v1).digest("hex")}`).toBe(backup.artwork.info.sha256);
  await page.goto(`/games/${game.slug}`); await page.reload();
  const cover = page.getByRole("img", { name: "Dice Dash cover", exact: true });
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([768, 1152]);
  await expect(page.getByLabel("Artwork credits", { exact: true })).toContainText(backup.artwork.info.credits.artist);
  const packageDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Save with credits", exact: true }).click();
  const packagePath = testInfo.outputPath("published.artwork.json"); await (await packageDownload).saveAs(packagePath);
  const packageText = await readFile(packagePath, "utf8");
  expect(packageText).not.toContain("alpha-local-fixture.png");
  expect(JSON.parse(packageText).artwork.info).toEqual(backup.artwork.info);
  await page.screenshot({ path: testInfo.outputPath("artwork-published-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("artwork-published-narrow.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/create");
  await page.getByRole("button", { name: "Upload image", exact: true }).click();
  await page.getByLabel("Image or saved artwork", { exact: true }).setInputFiles("apps/web/public/art/first-deal.webp");
  await page.getByLabel("Artist / credit", { exact: true }).fill("Digipology original illustration");
  await page.getByRole("button", { name: "Save artwork", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const stableV1 = await (await page.request.get(`/api/games/${game.slug}/cover?v=1`)).body(); expect(stableV1.equals(v1)).toBe(true);
  await page.route("**/api/games/*/cover?*", (route) => route.abort());
  await page.goto(`/games/${game.slug}`);
  await expect(page.getByRole("alert")).toContainText("artwork could not load");
  await page.screenshot({ path: testInfo.outputPath("artwork-missing-image-recovery.png"), fullPage: true });
  await page.unroute("**/api/games/*/cover?*");
  await page.getByRole("button", { name: "Retry artwork", exact: true }).click();
  await expect(cover).toBeVisible(); await expect(page.getByLabel("Artwork credits", { exact: true })).toContainText("Digipology original illustration");
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(768);
  await page.screenshot({ path: testInfo.outputPath("artwork-recovered-image-desktop.png"), fullPage: true });
  await importDraft(page, backupText);
  await replaceCover(page);
  await page.getByLabel("Image or saved artwork", { exact: true }).setInputFiles(packagePath);
  await expect(page.getByLabel("Artist / credit", { exact: true })).toHaveValue(backup.artwork.info.credits.artist);
  await page.getByRole("button", { name: "Save artwork", exact: true }).click();
  await expect(page.locator(".artwork-dialog")).toHaveCount(0); await closeArt(page); await ready(page);
});

test("damaged saved artwork stays visible as a repair task and never silently publishes", async ({ page }, testInfo) => {
  await create(page);
  await expect(page.getByRole("button", { name: "Publish & invite", exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith("dgp.editor.draft."))!;
    const draft = JSON.parse(localStorage.getItem(key)!); draft.artworkGeneration.jobs.cover.status = "running"; draft.artwork = { status: "ready", dataUrl: "data:image/png;base64,broken", info: { formatVersion: 1 } }; localStorage.setItem(key, JSON.stringify(draft));
  });
  let imageRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/ai/artwork") imageRequests++; });
  await page.reload(); await ready(page);
  await expect(page.getByRole("button", { name: "Publish draft & invite", exact: true })).toBeDisabled();
  await replaceCover(page);
  await expect(page.locator(".artwork-dialog").getByRole("alert")).toContainText("Replace it, or remove it");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".artwork-dialog").getByRole("alert")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("artwork-corrupt-backup-recovery-narrow.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove artwork", exact: true }).click();
  await closeArt(page);
  await expect(page.getByRole("button", { name: "Publish draft & invite", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Review playtest", exact: true })).toBeVisible();
  expect(imageRequests).toBe(0);
  await page.getByRole("button", { name: "Edit artwork", exact: true }).click();
  await page.locator('.game-art-asset[data-art-purpose="cover"]').getByRole("button", { name: "Retry cover", exact: true }).click();
  await expect(page.locator('.game-art-asset[data-art-purpose="cover"] .game-art-asset__state')).toHaveText("Ready");
  await closeArt(page);
  await expect(page.getByRole("button", { name: "Publish & invite", exact: true })).toBeEnabled();
  expect(imageRequests).toBe(1); // Only the deliberate repair requests an image.
  await page.screenshot({ path: testInfo.outputPath("artwork-explicit-repair-recovered-390.png"), fullPage: true });
});
