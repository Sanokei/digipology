import { test, expect, type Page, type TestInfo } from "./fixtures";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { rasterPng } from "../packages/protocol/src/raster.fixture";
import { crc32 } from "../packages/protocol/src/raster";

const fixturePath = fileURLToPath(new URL("./fixtures/raster-draft.editor.json", import.meta.url));

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(`editor-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json() as { link: string };
  await page.goto(link);
}
async function menu(page: Page, heading: string, action: string) {
  await page.locator(".editor-menu-dropdown > summary").filter({ hasText: new RegExp(`^${heading}$`) }).click();
  await page.locator(".editor-menu-dropdown[open]").getByRole("button", { name: action }).click();
}
async function importEditor(page: Page, path: string, id: string) {
  await page.goto(`/edit/${id}`);
  const choosing = page.waitForEvent("filechooser");
  await menu(page, "File", "Import draft or bundle…");
  await (await choosing).setFiles(path);
  await expect(page.locator(".editor-details-bar").getByLabel("Title", { exact: true })).not.toHaveValue("Untitled Game");
}
async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator(".table-render-status")).toHaveCount(0);
}
async function download(page: Page, testInfo: TestInfo, name: string, trigger: () => Promise<void>) {
  const pending = page.waitForEvent("download"); await trigger();
  const path = testInfo.outputPath(name); await (await pending).saveAs(path);
  return { path, value: JSON.parse(await readFile(path, "utf8")) };
}
async function sourceFieldAboveFooter(page: Page) {
  const field = page.getByLabel("Public source page", { exact: true });
  await expect(field).toBeFocused();
  await expect.poll(() => field.evaluate((input) => {
    const form = input.closest("form")!;
    const body = form.querySelector(".artwork-dialog__body")!.getBoundingClientRect();
    const footer = form.querySelector("footer")!.getBoundingClientRect();
    const rect = input.getBoundingClientRect();
    return rect.top >= body.top && rect.bottom <= body.bottom && rect.bottom + 8 <= footer.top && rect.top >= 0 && rect.bottom <= innerHeight;
  })).toBe(true);
  expect(await field.evaluate((input) => {
    const r = input.getBoundingClientRect();
    return [[r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]].every(([x, y]) => document.elementFromPoint(x!, y!) === input);
  })).toBe(true);
}
async function tabToSource(page: Page) {
  const field = page.getByLabel("Public source page", { exact: true });
  for (let i = 0; i < 9 && !await field.evaluate((input) => input === document.activeElement); i++) await page.keyboard.press("Tab");
  await sourceFieldAboveFooter(page);
}

test("real saved raster draft survives desktop rule edits, storage recovery, private review and idempotent publication", async ({ page }, testInfo) => {
  test.setTimeout(210_000);
  const original = JSON.parse(await readFile(fixturePath, "utf8"));
  let modelRequests = 0, publications = 0;
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/ai/")) modelRequests++; if (url.pathname === "/api/games" && request.method() === "POST") publications++; });
  await signIn(page);
  const id = `editor-handoff-${Date.now()}`;
  await importEditor(page, fixturePath, id);
  await expect(page.locator(".editor-details-bar").getByLabel("Title", { exact: true })).toHaveValue(original.title);
  await expect(page.locator(".editor-details-bar").getByLabel("Tagline", { exact: true })).toHaveValue(original.tagline);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restoreEditorStorage(): void }).restoreEditorStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith("dgp.editor.draft.")) throw new DOMException("Quota", "QuotaExceededError"); original.call(this, key, value); };
  });
  await menu(page, "Window", "Lua IDE");
  const script = original.bundle.files.find((file: { path: string }) => file.path === "scripts/game.lua").content as string;
  const editedScript = script.replace("previous + ctx.value", "previous + ctx.value + 1");
  expect(editedScript).not.toBe(script);
  await page.getByLabel("Lua IDE", { exact: true }).locator('.cm-content[contenteditable="true"]').fill(editedScript);
  await page.locator(".editor-details-bar").getByLabel("Title", { exact: true }).fill("Copper Dice Workshop");
  await page.keyboard.press("Enter");
  await page.locator(".editor-details-bar").getByLabel("Tagline", { exact: true }).fill("Every roll scores one extra point.");
  await page.keyboard.press("Enter");
  const release = await download(page, testInfo, "edited.release.json", () => menu(page, "File", "Export release bundle"));
  expect(release.value.editorVersion).toBeUndefined(); expect(release.value.artwork).toBeUndefined(); expect(release.value.generationReview).toBeUndefined();
  expect(release.value.files.find((file: { path: string }) => file.path === "scripts/game.lua").content).toBe(editedScript);
  await menu(page, "File", "Publish…");
  const recovery = page.getByRole("dialog", { name: "Keep your edited draft", exact: true });
  await expect(recovery.getByRole("alert")).toContainText("could not save");
  await expect(page).toHaveURL(new RegExp(`/edit/${id}$`));
  const close = page.getByRole("button", { name: "Close draft recovery", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByLabel("Draft recovery options", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(recovery.getByRole("button", { name: "Retry opening review", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(recovery.getByRole("button", { name: "Download editable draft", exact: true })).toBeFocused();
  const backup = await download(page, testInfo, "edited.editor.json", () => page.keyboard.press("Enter"));
  expect(backup.value.bundle).toEqual(release.value);
  expect(backup.value.bundle.integrity.manifestHash).not.toBe(original.bundle.integrity.manifestHash);
  expect(backup.value.generationReview).toEqual(original.generationReview);
  expect(backup.value.artwork).toEqual(original.artwork);
  expect(backup.value.tagline).toBe("Every roll scores one extra point.");
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.keyboard.press("Escape"); await expect(recovery).toHaveCount(0);
  await expect(page.locator(".editor-publish-button")).toBeFocused();
  await page.keyboard.press("Enter"); await expect(close).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("editor-storage-recovery-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(close).toBeInViewport(); await expect(recovery.getByRole("button", { name: "Retry opening review", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("editor-storage-recovery-narrow.png"), fullPage: true });
  await page.evaluate(() => (window as unknown as { restoreEditorStorage(): void }).restoreEditorStorage());
  await recovery.getByRole("button", { name: "Retry opening review", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/playtest/${id}$`)); await ready(page);
  await expect(page.locator(".draft-play-bar__tagline")).toHaveText(backup.value.tagline);
  const review = page.getByRole("button", { name: "Review playtest", exact: true });
  await expect(review).toHaveText("Review your changes");
  await expect(page.getByRole("img", { name: "Copper Dice Workshop cover", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("edited-private-play-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await review.click();
  await expect(page.getByRole("dialog", { name: "Try these at the table", exact: true })).toContainText("changed after the automated playtest");
  await page.screenshot({ path: testInfo.outputPath("edited-stale-review-desktop.png"), fullPage: true }); await page.keyboard.press("Escape");
  const progress = page.getByRole("complementary", { name: "Game progress", exact: true });
  await page.getByRole("button", { name: "Roll Die", exact: true }).click();
  await expect(progress.locator("li strong").first()).not.toHaveText("0");
  expect(Number(await progress.locator("li strong").first().innerText())).toBe(Number(await page.getByLabel("Die result", { exact: true }).innerText()) + 1);
  let lostReply = false, mode = "reject";
  await page.route("**/api/games/*/cover", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    if (mode === "reject") { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "cover_storage_unavailable", message: "Controlled artwork storage failure" } }) }); return; }
    const response = await route.fetch(); expect(response.status()).toBe(200); lostReply = true; await route.abort("failed");
  });
  await page.getByRole("button", { name: "Publish & invite", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry artwork publication", exact: true });
  await expect(retry).toBeVisible(); await expect(page.getByRole("button", { name: "Retry opening table", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("edited-artwork-publication-retry.png"), fullPage: true });
  mode = "lose-reply"; await retry.click(); await expect.poll(() => lostReply).toBe(true); await expect(retry).toBeEnabled();
  await page.unroute("**/api/games/*/cover"); await retry.click();
  await expect(page).toHaveURL(/\/table\//); await ready(page);
  const library = await (await page.request.get("/api/games/mine")).json();
  expect(publications).toBe(1); expect(library.games).toHaveLength(1);
  const game = library.games[0]; expect(game.coverVersion).toBe(1); expect(game.tagline).toBe(backup.value.tagline);
  const coreBefore = await (await page.request.get(`/api/releases/${game.latestReleaseId}/bundle`)).text();
  expect(JSON.parse(coreBefore).files.find((file: { path: string }) => file.path === "scripts/game.lua").content).toBe(editedScript);
  expect(JSON.parse(coreBefore).artwork).toBeUndefined(); expect(JSON.parse(coreBefore).generationReview).toBeUndefined();
  await page.reload(); await ready(page);
  await page.getByRole("button", { name: "Roll Die", exact: true }).click();
  await expect(progress.locator("li strong").first()).not.toHaveText("0");
  expect(Number(await progress.locator("li strong").first().innerText())).toBe(Number(await page.getByLabel("Die result", { exact: true }).innerText()) + 1);
  const v1 = await (await page.request.get(`/api/games/${game.slug}/cover?v=1`)).body();
  expect(`sha256:${createHash("sha256").update(v1).digest("hex")}`).toBe(backup.value.artwork.info.sha256);
  await page.goto(`/games/${game.slug}`); await page.reload();
  await expect(page.getByLabel("Artwork credits", { exact: true })).toContainText(original.artwork.info.credits.artist);
  await expect(page.getByRole("heading", { name: "Copper Dice Workshop", exact: true })).toBeVisible();
  const cover = page.getByRole("img", { name: "Copper Dice Workshop cover", exact: true });
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(768);
  const artPackage = await download(page, testInfo, "edited.artwork.json", () => page.getByRole("button", { name: "Save with credits", exact: true }).click());
  expect(artPackage.value.artwork.info).toEqual(backup.value.artwork.info);
  await page.screenshot({ path: testInfo.outputPath("edited-published-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("edited-published-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 }); await page.goto("/create");
  await page.getByRole("button", { name: "Upload image", exact: true }).click();
  await page.getByLabel("Image or saved artwork", { exact: true }).setInputFiles(artPackage.path);
  await expect(page.getByLabel("Artist / credit", { exact: true })).toHaveValue(original.artwork.info.credits.artist);
  await page.getByLabel("Artist / credit", { exact: true }).fill("Updated workshop credit");
  await page.getByRole("button", { name: "Save artwork", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await (await page.request.get(`/api/games/${game.slug}/cover?v=1`)).body()).equals(v1)).toBe(true);
  expect(await (await page.request.get(`/api/games/${game.slug}/cover-info?v=1`)).json()).toMatchObject({ artwork: { credits: original.artwork.info.credits } });
  expect(await (await page.request.get(`/api/games/${game.slug}/cover-info?v=2`)).json()).toMatchObject({ artwork: { credits: { artist: "Updated workshop credit" } } });
  expect(await (await page.request.get(`/api/releases/${game.latestReleaseId}/bundle`)).text()).toBe(coreBefore);
  await importEditor(page, backup.path, `reopened-${Date.now()}`);
  await expect(page.locator(".editor-details-bar").getByLabel("Title", { exact: true })).toHaveValue(backup.value.title);
  const reopened = await download(page, testInfo, "reopened.editor.json", () => menu(page, "File", "Download editable draft"));
  expect(reopened.value.artwork).toEqual(backup.value.artwork); expect(reopened.value.generationReview).toEqual(backup.value.generationReview);
  expect(reopened.value.bundle).toEqual(backup.value.bundle);
  await menu(page, "File", "Publish…"); await ready(page); await expect(review).toHaveText("Review your changes");
  expect(modelRequests).toBe(0);
});

test("artwork source field stays above its footer with keyboard focus at 390px and short height, including decode failure", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page); await page.goto("/create");
  await page.locator("summary").filter({ hasText: "Upload an existing game" }).click();
  await page.getByLabel("Game JSON file", { exact: true }).setInputFiles(fixturePath);
  await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  const edit = page.getByRole("button", { name: "Edit artwork", exact: true }); await edit.click();
  const replace = page.locator('.game-art-asset[data-art-purpose="cover"]').getByRole("button", { name: "Replace image…", exact: true }); await replace.click();
  await expect(page.getByRole("button", { name: "Close artwork", exact: true })).toBeFocused();
  await tabToSource(page);
  await page.screenshot({ path: testInfo.outputPath("source-field-desktop.png"), fullPage: true });
  for (const height of [844, 480]) {
    await page.setViewportSize({ width: 390, height });
    await sourceFieldAboveFooter(page);
    await expect(page.getByRole("button", { name: "Close artwork", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Save artwork", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`source-field-390x${height}.png`), fullPage: true });
  }
  const preview = page.locator(".artwork-dialog").getByRole("img"); const previous = await preview.getAttribute("src");
  const broken = rasterPng(768, 1152), view = new DataView(broken.buffer);
  const length = view.getUint32(33); broken[41] = 0; broken[42] = 0; view.setUint32(41 + length, crc32(broken.subarray(37, 41 + length)));
  await page.getByLabel("Image or saved artwork", { exact: true }).setInputFiles({ name: "invalid-pixels.png", mimeType: "image/png", buffer: Buffer.from(broken) });
  await expect(page.getByRole("alert")).toContainText("could not be decoded");
  expect(await preview.getAttribute("src")).toBe(previous);
  await tabToSource(page); await sourceFieldAboveFooter(page);
  await page.screenshot({ path: testInfo.outputPath("source-field-decode-recovery-short.png"), fullPage: true });
  await page.getByLabel("Image or saved artwork", { exact: true }).setInputFiles("apps/web/public/art/first-deal.webp");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Save artwork", exact: true }).click();
  await expect(page.locator(".artwork-dialog")).toHaveCount(0); await expect(replace).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(edit).toBeFocused(); await ready(page);
});
