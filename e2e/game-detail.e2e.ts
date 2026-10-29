import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { CreateGameResponse, GameResponse } from "../packages/protocol/src/http";

const fixturePath = fileURLToPath(new URL("./fixtures/raster-draft.editor.json", import.meta.url));
const csrf = { "X-Digipology-CSRF": "1" };

async function publishFixture(owner: Page, title: string, cover: boolean) {
  await owner.goto("/login");
  await owner.getByLabel("Email address", { exact: true }).fill(`game-entry-${Date.now()}@example.com`);
  await owner.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await owner.request.get("/api/dev/last-magic-link")).json() as { link: string };
  await owner.goto(link);
  const draft = JSON.parse(await readFile(fixturePath, "utf8"));
  const bytes = Buffer.from(draft.artwork.dataUrl.split(",")[1], "base64");
  const response = await owner.request.post("/api/games", { headers: csrf, data: {
    title, tagline: draft.tagline, minPlayers: 2, maxPlayers: 4,
    slug: `entry-${Date.now()}`, bundle: { ...draft.bundle, title },
  } });
  expect(response.status()).toBe(201);
  const { game } = await response.json() as CreateGameResponse;
  async function upload() {
    const result = await owner.request.post(`/api/games/${game.slug}/cover`, { headers: {
      ...csrf, "Content-Type": draft.artwork.info.contentType,
      "X-Digipology-Cover-Credits": encodeURIComponent(JSON.stringify(draft.artwork.info.credits)),
    }, data: bytes });
    expect(result.status()).toBe(200);
    expect(await result.json()).toEqual({ coverVersion: 1 });
  }
  if (cover) await upload();
  expect((await owner.request.patch(`/api/games/${game.slug}`, { headers: csrf, data: { visibility: "public" } })).ok()).toBe(true);
  return { game, bytes, info: draft.artwork.info, upload };
}

async function settled(page: Page, title: string, coverWidth?: number) {
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  if (coverWidth !== undefined) await expect.poll(() => page.getByRole("img", { name: `${title} cover`, exact: true }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(coverWidth);
}

async function fullyVisible(control: Locator) {
  expect(await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
}

async function entryFrame(page: Page, testInfo: TestInfo, name: string, title: string) {
  await page.evaluate(() => scrollTo(0, 0));
  const heading = page.getByRole("heading", { name: title, exact: true });
  const action = page.getByText("Play or host", { exact: true });
  await writeFile(testInfo.outputPath(`${name}.json`), JSON.stringify({
    viewport: page.viewportSize(), title: await heading.boundingBox(), action: await action.boundingBox(),
    scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
  }, null, 2));
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
  await fullyVisible(heading); await fullyVisible(action);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator(".table-render-status")).toHaveCount(0);
}

test("a public raster game exposes its identity and host action before artwork, preserving original downloads and invite entry", async ({ page: owner, browser }, testInfo) => {
  test.setTimeout(150_000);
  const title = "Copper Dice Workshop";
  const { game, bytes, info } = await publishFixture(owner, title, true);
  const friend = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 1440, height: 960 } });
  const page = await friend.newPage();
  await page.goto(`/games/${game.slug}`); await settled(page, title, 768);
  await expect(page.getByLabel("Artwork credits", { exact: true })).toContainText(info.credits.artist);
  await entryFrame(page, testInfo, "portrait-desktop", title);
  await page.setViewportSize({ width: 390, height: 844 });
  await entryFrame(page, testInfo, "portrait-390", title);
  const action = page.getByRole("button", { name: "Play or host", exact: true });
  await fullyVisible(page.getByText("2–4 players", { exact: true }));
  await page.setViewportSize({ width: 390, height: 480 });
  await entryFrame(page, testInfo, "portrait-short", title);
  await page.setViewportSize({ width: 390, height: 844 });
  const fullArtwork = page.getByRole("link", { name: "View full artwork", exact: true });
  expect(await fullArtwork.getAttribute("href")).toBe(`/api/games/${game.slug}/cover?v=1`);
  await fullArtwork.scrollIntoViewIfNeeded();
  await fullArtwork.focus(); await expect(fullArtwork).toBeFocused();
  const opened = page.waitForEvent("popup"); await page.keyboard.press("Enter");
  const imagePage = await opened;
  await expect.poll(() => imagePage.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(768);
  expect((await imagePage.request.get(imagePage.url())).ok()).toBe(true); await imagePage.close();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save image", exact: true }).click();
  const rawPath = testInfo.outputPath("original-cover.webp"); await (await downloading).saveAs(rawPath);
  expect((await readFile(rawPath)).equals(bytes)).toBe(true);
  const packaging = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save with credits", exact: true }).click();
  const packagePath = testInfo.outputPath("original.artwork.json"); await (await packaging).saveAs(packagePath);
  const artPackage = JSON.parse(await readFile(packagePath, "utf8")); expect(artPackage.artwork.info).toEqual(info);
  await page.screenshot({ path: testInfo.outputPath("portrait-credits-390.png"), fullPage: false });

  // A direct unlisted link must retain its selected game even though the public catalog omits it.
  expect((await owner.request.patch(`/api/games/${game.slug}`, { headers: csrf, data: { visibility: "unlisted" } })).ok()).toBe(true);
  const catalog = await (await page.request.get("/api/games")).json();
  expect(catalog.games.some((item: { slug: string }) => item.slug === game.slug)).toBe(false);
  await page.reload(); await settled(page, title, 768);
  await page.getByRole("link", { name: "All games", exact: false }).focus();
  await page.keyboard.press("Tab"); await expect(action).toBeFocused(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Host a game", exact: true });
  await expect(dialog.getByLabel("Game", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Game", { exact: true })).toHaveValue(game.slug);
  await expect(dialog.getByLabel("Game", { exact: true }).locator("option:checked")).toContainText(title);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(action).toBeFocused();
  // Catalog availability is optional once the visitor has loaded a valid game detail.
  await page.route("**/api/games", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "Catalog unavailable in this controlled failure" } }) }));
  await page.keyboard.press("Enter"); await expect(dialog.getByLabel("Game", { exact: true })).toHaveValue(game.slug);
  await dialog.getByLabel("Display name", { exact: true }).fill("Copper host");
  await page.screenshot({ path: testInfo.outputPath("selected-host-390.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Create table", exact: true }).click();
  const invite = page.getByLabel("Invite URL", { exact: true }); await expect(invite).toBeFocused();
  const inviteUrl = await invite.inputValue(); expect(new URL(inviteUrl).origin).toBe(new URL(page.url()).origin);
  await page.getByRole("button", { name: "Enter table", exact: true }).click(); await ready(page);
  await expect(page.locator(".table-topbar__game strong")).toHaveText(title);
  await page.screenshot({ path: testInfo.outputPath("selected-table-390.png"), fullPage: false });
  const guest = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 390, height: 844 } });
  const guestPage = await guest.newPage(); await guestPage.goto(inviteUrl);
  await guestPage.getByLabel("Display name", { exact: true }).fill("Copper guest");
  await guestPage.getByRole("button", { name: "Join table", exact: true }).click(); await ready(guestPage);
  await expect(guestPage.locator(".table-topbar__game strong")).toHaveText(title);
  await expect(guestPage.getByRole("button", { name: "Show 2 players", exact: true })).toBeVisible();
  await guestPage.screenshot({ path: testInfo.outputPath("invited-table-390.png"), fullPage: false });
  const detail = await (await owner.request.get(`/api/games/${game.slug}`)).json() as GameResponse;
  expect(detail.game.coverVersion).toBe(1);
  expect(await (await owner.request.get(`/api/games/${game.slug}/cover-info?v=1`)).json()).toEqual({ coverVersion: 1, artwork: info });
  expect(`sha256:${createHash("sha256").update(await (await owner.request.get(`/api/games/${game.slug}/cover?v=1`)).body()).digest("hex")}`).toBe(info.sha256);
  await writeFile(testInfo.outputPath("original-integrity.json"), JSON.stringify({ coverVersion: 1, info, downloadedBytesEqual: true, hostedSlug: game.slug, invitedPlayers: 2 }, null, 2));
  await guest.close(); await friend.close();
});

test("long titles and absent, landscape or failed covers keep the entry usable across narrow, short and desktop layouts", async ({ page: owner, browser }, testInfo) => {
  test.setTimeout(120_000);
  const title = "Remarkably Long Dice Adventures of CoppercliffandtheUnreasonablyLongWorkshopName";
  expect(title.length).toBe(80);
  const { game, upload } = await publishFixture(owner, title, false);
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto(`/games/${game.slug}`); await settled(page, title);
  await expect(page.locator(".game-detail__cover img")).toHaveCount(0);
  await entryFrame(page, testInfo, "long-title-no-cover-390", title);
  await page.setViewportSize({ width: 390, height: 480 });
  await entryFrame(page, testInfo, "long-title-no-cover-short", title);
  await upload(); await page.reload(); await settled(page, title, 768);
  await entryFrame(page, testInfo, "long-title-portrait-short", title);
  const coverRoute = `**/api/games/${game.slug}/cover?*`;
  // Layout stress only: the upload API intentionally admits portrait artwork. This
  // response fixture serves an existing repository landscape; it is not an upload.
  const landscape = await readFile(fileURLToPath(new URL("../apps/web/public/art/tabletop-world.webp", import.meta.url)));
  await page.route(coverRoute, (route) => route.fulfill({ contentType: "image/webp", body: landscape }));
  await page.reload(); await settled(page, title, 1672);
  await page.setViewportSize({ width: 390, height: 844 }); await entryFrame(page, testInfo, "landscape-390", title);
  await page.setViewportSize({ width: 1440, height: 960 }); await entryFrame(page, testInfo, "landscape-desktop", title);
  await page.unroute(coverRoute);
  await page.route(coverRoute, (route) => route.fulfill({ status: 404, body: "Controlled missing cover" }));
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await settled(page, title);
  await expect(page.getByRole("alert")).toContainText("Your game is still available");
  await entryFrame(page, testInfo, "failed-cover-390", title);
  await page.getByRole("button", { name: "Retry artwork", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Retry artwork", exact: true })).toBeFocused();
  await page.unroute(coverRoute); await page.keyboard.press("Enter"); await settled(page, title, 768);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await entryFrame(page, testInfo, "recovered-cover-390", title);
  await context.close();
});

test("detail hosting keeps Close and Create table usable at short height and preserves the game through sign-in dismissal", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto("/games/dice-dash"); await settled(page, "Dice Dash", 1024);
  const trigger = page.getByRole("button", { name: "Play or host", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Host a game", exact: true });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  const create = dialog.getByRole("button", { name: "Create table", exact: true });
  await expect(dialog.getByLabel("Game", { exact: true })).toBeFocused();
  await fullyVisible(close); await fullyVisible(create);
  expect(await close.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("host-short-ready.png"), fullPage: false });
  await close.focus(); await page.keyboard.press("Shift+Tab"); await expect(create).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await dialog.getByRole("radio", { name: "Public", exact: true }).check();
  await dialog.getByRole("button", { name: "Sign in to continue", exact: true }).click();
  const signIn = page.getByRole("dialog", { name: "Welcome back", exact: true });
  await expect(signIn.getByRole("button", { name: "Close sign in", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("host-sign-in-short.png"), fullPage: false });
  await page.keyboard.press("Escape"); await expect(signIn).toHaveCount(0); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Game", { exact: true })).toHaveValue("dice-dash");
  await dialog.getByRole("radio", { name: "Private", exact: true }).check();
  await dialog.getByLabel("Display name", { exact: true }).fill("Short-height guest");
  await create.focus(); await fullyVisible(create);
  await page.setViewportSize({ width: 1440, height: 960 }); await expect(create).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});
