import { test, expect, type Page, type TestInfo } from "./fixtures";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { rasterPng } from "../packages/protocol/src/raster.fixture";
import { crc32 } from "../packages/protocol/src/raster";

const fixture = fileURLToPath(new URL("./fixtures/raster-draft.editor.json", import.meta.url));
const path = "runtime/presentation/card-back.json";
type PaintedWindow = Window & { paintedBacks: string[] };
async function monitor(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as PaintedWindow; target.paintedBacks = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image: CanvasImageSource, ...coordinates: number[]) {
      if (image instanceof HTMLImageElement && image.src.startsWith("data:image/")) target.paintedBacks.push(image.src);
      Reflect.apply(draw, this, [image, ...coordinates]);
    };
  });
}
async function menu(page: Page, action: string) {
  await page.locator(".editor-menu-dropdown > summary").filter({ hasText: /^File$/ }).click();
  await page.locator(".editor-menu-dropdown[open]").getByRole("button", { name: action }).click();
}
async function download(page: Page, info: TestInfo, name: string, trigger: () => Promise<void>) {
  const waiting = page.waitForEvent("download"); await trigger(); const dest = info.outputPath(name);
  await (await waiting).saveAs(dest); return { path: dest, value: JSON.parse(await readFile(dest, "utf8")) };
}
async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator(".table-render-status")).toHaveCount(0);
  await expect(page.locator("[data-card-back-state]")).toHaveAttribute("data-card-back-state", "ready");
}
async function importEditor(page: Page, value: object, id: string) {
  await page.goto(`/edit/${id}`); const choosing = page.waitForEvent("filechooser"); await menu(page, "Import draft or bundle…");
  await (await choosing).setFiles({ name: "existing-card-game.editor.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  await expect(page.locator(".editor-details-bar").getByLabel("Title", { exact: true })).toHaveValue((value as { title: string }).title);
}
async function centerInspect(page: Page) {
  await page.bringToFront();
  const canvas = page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true }), box = await canvas.boundingBox();
  if (!box) throw new Error("No table canvas");
  await canvas.click({ button: "right", position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByRole("menuitem", { name: "Inspect", exact: true }).click();
}

test("different games retain their own raster backs through editor, private play, publication, guest inspection and backup", async ({ page, browser }, info) => {
  test.setTimeout(240_000); await monitor(page);
  await page.goto("/login"); await page.getByLabel("Email address", { exact: true }).fill(`backs-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click(); await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json(); await page.goto(link);
  const original = JSON.parse(await readFile(fixture, "utf8"));
  const cards = await (await page.request.get("/api/releases/builtin_first_deal_2/bundle")).json();
  // Existing authored First Deal rules + an existing raster fixture, not model output.
  const authored = { ...original, id: `card-back-${Date.now()}`, title: "Card Back Workshop", slug: "card-back-workshop", bundle: { ...cards, title: "Card Back Workshop" } };
  await importEditor(page, authored, authored.id);
  const baseline = await download(page, info, "before-back.editor.json", () => menu(page, "Download editable draft"));
  await menu(page, "Card backs…"); let dialog = page.getByRole("dialog", { name: "Card backs for Card Back Workshop", exact: true });
  await dialog.getByLabel("Image or saved artwork", { exact: true }).setInputFiles({ name: "explicit-fixture-card-back.artwork.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ kind: "digipology-card-back", version: 1, artwork: original.artwork })) });
  await page.setViewportSize({ width: 390, height: 480 });
  await dialog.getByLabel("Public source page", { exact: true }).focus();
  await expect.poll(async () => {
    const field = await dialog.getByLabel("Public source page", { exact: true }).boundingBox(), footer = await dialog.locator("footer").boundingBox();
    return field !== null && footer !== null && field.y + field.height <= footer.y;
  }).toBe(true);
  await page.screenshot({ path: info.outputPath("back-editor-short.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Use for card backs", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  const saved = await download(page, info, "with-back.editor.json", () => menu(page, "Download editable draft"));
  const release = await download(page, info, "with-back.release.json", () => menu(page, "Export release bundle"));
  const asset = saved.value.bundle.files.find((file: { path: string }) => file.path === path), back = JSON.parse(asset.content);
  expect(back.artwork.dataUrl).toBe(original.artwork.dataUrl); expect(back.artwork.info).toEqual(original.artwork.info); expect(back.artwork.source).toBeUndefined();
  expect(saved.value.bundle.initialSnapshot).toEqual(baseline.value.bundle.initialSnapshot);
  expect(saved.value.bundle.files.filter((file: { path: string }) => file.path !== path)).toEqual(baseline.value.bundle.files);
  expect(release.value.files.find((file: { path: string }) => file.path === path)).toEqual(asset);
  expect(release.value.artwork).toBeUndefined(); expect(saved.value.artwork).toEqual(original.artwork);
  await menu(page, "Card backs…"); dialog = page.getByRole("dialog", { name: "Card backs for Card Back Workshop", exact: true });
  const broken = rasterPng(768, 1152), view = new DataView(broken.buffer), n = view.getUint32(33);
  broken[41] = 0; broken[42] = 0; view.setUint32(41 + n, crc32(broken.subarray(37, 41 + n)));
  await dialog.getByLabel("Image or saved artwork", { exact: true }).setInputFiles({ name: "invalid-pixels.png", mimeType: "image/png", buffer: Buffer.from(broken) });
  await expect(dialog.getByRole("alert")).toContainText("could not be decoded");
  await page.screenshot({ path: info.outputPath("back-decode-recovery.png"), fullPage: false }); await page.keyboard.press("Escape");
  await menu(page, "Publish…"); await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  await expect(page.locator("[data-card-back-key]")).toHaveAttribute("data-card-back-key", back.artwork.info.sha256);
  await expect.poll(() => page.evaluate((src) => (window as unknown as PaintedWindow).paintedBacks.includes(src), back.artwork.dataUrl)).toBe(true);
  await page.getByRole("button", { name: "Shuffle deck", exact: true }).click(); await page.getByRole("button", { name: "Draw card", exact: true }).click();
  const hand = page.getByRole("button", { name: /^Inspect / }); await expect(hand).toHaveCount(1);
  await hand.click({ button: "right" }); await page.getByRole("menuitem", { name: "Play to table", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  await page.screenshot({ path: info.outputPath("private-themed-back-390.png"), fullPage: false });
  await page.evaluate(() => { (window as unknown as PaintedWindow).paintedBacks = []; });
  await page.getByRole("button", { name: "Publish & invite", exact: true }).click(); await expect(page).toHaveURL(/\/table\//); await ready(page);
  await expect.poll(() => page.evaluate((src) => (window as unknown as PaintedWindow).paintedBacks.includes(src), back.artwork.dataUrl)).toBe(true);
  const library = await (await page.request.get("/api/games/mine")).json(), game = library.games.find((g: { title: string }) => g.title === authored.title);
  const actual = await (await page.request.get(`/api/releases/${game.latestReleaseId}/bundle`)).json();
  expect(actual.files.find((file: { path: string }) => file.path === path).content).toBe(asset.content);
  await page.reload(); await ready(page); await expect(page.locator("[data-card-back-key]")).toHaveAttribute("data-card-back-key", back.artwork.info.sha256);
  const invite = await page.getByRole("button", { name: "Copy invite link", exact: true }).getAttribute("title");
  const guestContext = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage(); await monitor(guest); await guest.goto(invite!); await guest.getByLabel("Display name", { exact: true }).fill("Artwork guest"); await guest.getByRole("button", { name: "Join table", exact: true }).click(); await ready(guest);
    await expect(guest.locator("[data-card-back-key]")).toHaveAttribute("data-card-back-key", back.artwork.info.sha256);
    await page.bringToFront(); await page.getByRole("button", { name: "Shuffle deck", exact: true }).click(); await page.getByRole("button", { name: "Draw card", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1); await expect(guest.getByRole("button", { name: /^Inspect / })).toHaveCount(0);
    await page.getByRole("button", { name: /^Inspect / }).click({ button: "right" }); await page.getByRole("menuitem", { name: "Play to table", exact: true }).click();
    // Desktop framing keeps the ordinary center-pick action independent of phone framing.
    await guest.setViewportSize({ width: 1440, height: 960 }); await ready(guest); await centerInspect(guest);
    await expect(guest.getByRole("dialog", { name: "Inspecting Face-down card", exact: true })).toBeVisible();
    await expect(guest.locator(".inspect-overlay__preview [data-card-face='card-back'] canvas")).toBeVisible();
    await expect(guest.locator(".inspect-overlay__preview [data-card-face='standard-card']")).toHaveCount(0);
    await expect(guest.locator(".inspect-card-credits")).toContainText(back.artwork.info.credits.artist);
    const pending = guest.waitForEvent("download"); await guest.getByRole("link", { name: "Download card-back image", exact: true }).click();
    const image = info.outputPath("published-back.png"); await (await pending).saveAs(image);
    expect(`sha256:${createHash("sha256").update(await readFile(image)).digest("hex")}`).toBe(back.artwork.info.sha256);
    await guest.screenshot({ path: info.outputPath("guest-themed-inspection-desktop.png"), fullPage: false });
    await guest.setViewportSize({ width: 390, height: 844 }); await guest.screenshot({ path: info.outputPath("guest-themed-inspection-390.png"), fullPage: false });
  } finally { await guestContext.close(); }
  await page.setViewportSize({ width: 1440, height: 960 }); await importEditor(page, saved.value, `reopened-back-${Date.now()}`);
  const reopened = await download(page, info, "reopened-back.editor.json", () => menu(page, "Download editable draft"));
  expect(reopened.value.bundle).toEqual(saved.value.bundle);
  const another = { ...saved.value, id: `night-cards-${Date.now()}`, title: "Night Card Workshop", slug: `night-cards-${Date.now()}`, bundle: { ...saved.value.bundle, title: "Night Card Workshop" } };
  await importEditor(page, another, another.id);
  await menu(page, "Card backs…"); dialog = page.getByRole("dialog", { name: "Card backs for Night Card Workshop", exact: true });
  await dialog.getByLabel("Image or saved artwork", { exact: true }).setInputFiles("apps/web/public/art/zone-runner.webp");
  await expect(dialog.getByRole("alert")).toHaveCount(0); await dialog.getByRole("button", { name: "Use for card backs", exact: true }).click();
  const second = await download(page, info, "different-back.editor.json", () => menu(page, "Download editable draft"));
  const secondBack = JSON.parse(second.value.bundle.files.find((file: { path: string }) => file.path === path).content);
  expect(secondBack.artwork.info.sha256).not.toBe(back.artwork.info.sha256);
  await menu(page, "Publish…"); await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  await expect(page.locator("[data-card-back-key]")).toHaveAttribute("data-card-back-key", secondBack.artwork.info.sha256);
  await page.getByRole("button", { name: "Publish & invite", exact: true }).click(); await expect(page).toHaveURL(/\/table\//); await ready(page);
  await expect(page.locator("[data-card-back-key]")).toHaveAttribute("data-card-back-key", secondBack.artwork.info.sha256);
  await page.screenshot({ path: info.outputPath("different-themed-back-desktop.png"), fullPage: false });
  const secondLibrary = await (await page.request.get("/api/games/mine")).json(); expect(secondLibrary.games).toHaveLength(2);
  const firstAgain = await (await page.request.get(`/api/releases/${game.latestReleaseId}/bundle`)).json();
  expect(firstAgain.files.find((file: { path: string }) => file.path === path).content).toBe(asset.content);
  await writeFile(info.outputPath("back-roundtrip.json"), JSON.stringify({ firstHash: back.artwork.info.sha256, secondHash: secondBack.artwork.info.sha256, originalCoverRetained: true, canonicalInitialStateUnchanged: true, exactPublishedAsset: true, exactDownloadedImage: true, actualRasterDrawObserved: true, fixtureScope: "Existing First Deal rules + local raster fixtures, no model generation" }, null, 2));
});

test("missing game-back images show a playable fallback and recover through retry", async ({ page }, info) => {
  await page.route("**/art/first-deal.webp", (route) => route.fulfill({ status: 503, body: "controlled missing image" }));
  await page.goto("/"); await page.getByRole("button", { name: /host a room/i }).first().click(); await page.getByLabel("Game", { exact: true }).selectOption("first-deal"); await page.getByLabel("Display name", { exact: true }).fill("Back recovery"); await page.getByRole("button", { name: "Create table", exact: true }).click(); await page.getByRole("button", { name: "Enter table", exact: true }).click();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator("[data-card-back-state]")).toHaveAttribute("data-card-back-state", "failed");
  await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("missing-back-desktop.png"), fullPage: false });
  await page.unroute("**/art/first-deal.webp"); await page.getByRole("button", { name: "Retry card artwork", exact: true }).click(); await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath("back-recovered-390.png"), fullPage: false });
});
