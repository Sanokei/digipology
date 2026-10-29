import { hashValue } from "../packages/canonical-json/src/index";
import { test, expect, type Page, type TestInfo } from "./fixtures";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { CardDesigns } from "../packages/protocol/src/card-designs";
const PATH = "runtime/presentation/cards.json";
async function ready(page: Page) { await page.bringToFront(); await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 }); await expect(page.locator(".table-render-status")).toHaveCount(0); }
async function signIn(page: Page) { await page.goto("/login"); await page.getByLabel("Email address", { exact: true }).fill(`printed-${Date.now()}@example.com`); await page.getByRole("button", { name: "Email me a link", exact: true }).click(); await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible(); const { link } = await (await page.request.get("/api/dev/last-magic-link")).json(); await page.goto(link); }
async function saved(page: Page) { return page.evaluate(() => { const id = decodeURIComponent(location.pathname.split("/").at(-1)!); return JSON.parse(localStorage.getItem(`dgp.editor.draft.${encodeURIComponent(id)}`)!); }); }
function designs(draft: any): CardDesigns { return JSON.parse(draft.bundle.files.find((f: any) => f.path === PATH).content); }
async function artwork(page: Page) { await page.getByRole("button", { name: "Edit artwork", exact: true }).click(); return page.getByRole("dialog", { name: /^Artwork for / }); }
async function capture(page: Page, info: TestInfo, name: string) { await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await page.screenshot({ path: info.outputPath(name), fullPage: false }); }
async function menu(page: Page, action: string) { await page.locator(".editor-menu-dropdown > summary").filter({ hasText: /^File$/ }).click(); await page.locator(".editor-menu-dropdown[open]").getByRole("button", { name: action }).click(); }
async function download(page: Page, info: TestInfo, name: string, trigger: () => Promise<void>) { const pending = page.waitForEvent("download"); await trigger(); const path = info.outputPath(name); await (await pending).saveAs(path); return { path, value: JSON.parse(await readFile(path, "utf8")) }; }
async function create(page: Page) {
  await signIn(page); await page.goto("/create"); await page.getByLabel("Game description", { exact: true }).fill("[raster-cards-fixture] [card-designs-fixture] Verify authored printed fields and two actual deck families. Technical inputs, not live generation or approved artwork.");
  const pending = page.waitForResponse((r) => r.url().endsWith("/api/ai/games") && r.request().method() === "POST"); await page.getByRole("button", { name: "Create & play", exact: true }).click(); const accepted = await (await pending).json();
  await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  await expect.poll(async () => { const d = await saved(page); return d.artworkGeneration?.cardJobs?.map((j: any) => ({ kind: j.kind, status: j.job.status, message: j.job.message ?? "" })); }, { timeout: 45_000 }).toEqual([{ kind: "family-back", status: "ready", message: "" }, { kind: "family-illustration", status: "ready", message: "" }, { kind: "family-back", status: "ready", message: "" }, { kind: "family-illustration", status: "ready", message: "" }]);
  await expect(page.getByRole("button", { name: "Publish & invite", exact: true })).toBeEnabled(); return accepted;
}

test("authored card fronts and distinct family backs survive normal editing, private play, publication and owner/guest reload", async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const accepted = await create(page), first = await saved(page), doc = designs(first);
  expect(doc.assets).toHaveLength(4); expect(first.bundle.initialSnapshot).toEqual(accepted.draft.initialSnapshot);
  const backA = doc.assets.find((a) => a.id === doc.families[0]!.backAssetId)!, backB = doc.assets.find((a) => a.id === doc.families[1]!.backAssetId)!;
  expect(backA.artwork.info.sha256).not.toBe(backB.artwork.info.sha256);
  expect(doc.assets.filter((a) => a.purpose === "card-illustration").every((a) => a.artwork.info.width === 768 && a.artwork.info.height === 512)).toBe(true);
  await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.locator(".hand-card")).toHaveCount(1);
  const ownLabel = (await page.locator(".hand-card").getAttribute("aria-label"))!.replace("Inspect ", "");
  const own = doc.cards.find((c) => c.title === ownLabel)!;
  await page.locator(".hand-card").click(); const inspect = page.getByRole("dialog", { name: `Inspecting ${ownLabel}`, exact: true });
  await expect(inspect.locator('[data-card-face="designed-card"]')).toBeVisible(); await expect(inspect.getByRole("region", { name: "Full card rules", exact: true })).toContainText("2 tokens"); await capture(page, info, "owner-printed-front-desktop.png"); await page.keyboard.press("Escape");
  const art = await artwork(page), editor = art.getByRole("region", { name: "Cards and decks", exact: true });
  await editor.getByLabel("Printed card", { exact: true }).selectOption(own.definitionId);
  await editor.getByLabel("Printed effect", { exact: true }).fill("A changed printed effect. " + "Long source text stays complete and scrollable in inspection. ".repeat(35) + "FINAL PRINTED LINE.");
  await editor.getByRole("button", { name: "Save card designs", exact: true }).click(); await expect(editor.getByRole("button", { name: "Save card designs", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 }); await capture(page, info, "card-editor-390.png"); await art.getByRole("button", { name: "Close game artwork", exact: true }).click();
  await page.locator(".hand-card").click(); const long = page.getByRole("region", { name: "Full card rules", exact: true }); await expect(long).toContainText("FINAL PRINTED LINE."); await long.focus(); await page.keyboard.press("End"); await capture(page, info, "owner-full-rules-390.png"); await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 480 }); await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.locator(".hand-card")).toHaveCount(2); await capture(page, info, "two-decks-hand-short.png");
  const after = await saved(page); expect(after.bundle.initialSnapshot).toEqual(first.bundle.initialSnapshot); expect(after.bundle.integrity.manifestHash).not.toBe(first.bundle.integrity.manifestHash); expect(after.generationReview.manifestHash).not.toBe(after.bundle.integrity.manifestHash);
  await page.setViewportSize({ width: 1440, height: 960 }); await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.locator(".editor-details-bar").getByLabel("Title", { exact: true })).toHaveValue(first.title);
  const backup = await download(page, info, "cards.editor.json", () => menu(page, "Download editable draft")); expect(designs(backup.value)).toEqual(designs(after));
  await menu(page, "Publish…"); await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  await page.getByRole("button", { name: "Publish & invite", exact: true }).click(); await expect(page).toHaveURL(/\/table\//); await ready(page);
  if (info.project.name === "native-card") { const url = new URL(page.url()); url.searchParams.set("renderer", "lite"); await page.goto(url.href); await ready(page); await expect(page.locator(".renderer-override-chip")).toContainText("Renderer: lite"); }
  await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.locator(".hand-card")).toHaveCount(1); const publicOwn = await page.locator(".hand-card").getAttribute("aria-label");
  const invite = (await page.getByRole("button", { name: "Copy invite link", exact: true }).getAttribute("title"))!;
  // The native check represents separate visitors/devices with independent GPU
  // processes. A retained earlier same-process software-GPU run stalled at the
  // second seat; this check does not establish multi-tab software-GPU support.
  const guestBrowser = info.project.name === "native-card"
    ? await browser.browserType().launch(info.project.use.launchOptions)
    : null;
  try {
  const guest = await (guestBrowser ?? browser).newContext();
  try {
  const other = await guest.newPage(); await other.goto(invite); await other.getByLabel("Display name", { exact: true }).fill("Other seat"); await other.getByRole("button", { name: "Join table", exact: true }).click(); await ready(other);
  if (info.project.name === "native-card") { const url = new URL(other.url()); url.searchParams.set("renderer", "lite"); await other.goto(url.href); await ready(other); await expect(other.locator(".renderer-override-chip")).toContainText("Renderer: lite"); }
  await expect(other.locator(".hand-card")).toHaveCount(0); await expect(other.getByRole("button", { name: publicOwn!, exact: true })).toHaveCount(0); await capture(other, info, "guest-no-front-leak.png");
  await page.bringToFront(); await page.reload(); await ready(page); await expect(page.getByRole("button", { name: publicOwn!, exact: true })).toBeVisible(); await capture(page, info, "published-owner-recovered.png");
  const library = await (await page.request.get("/api/games/mine")).json(); expect(library.games).toHaveLength(1);
  const raw = await page.request.get(`/api/releases/${library.games[0].latestReleaseId}/bundle`); expect(raw.ok()).toBe(true);
  const returned = await raw.json(); expect(returned.files.find((f: any) => f.path === PATH)).toEqual(backup.value.bundle.files.find((f: any) => f.path === PATH)); expect(returned.initialSnapshot.state).toEqual({ ...first.bundle.initialSnapshot.state, releaseId: returned.releaseId }); expect(returned.initialSnapshot.releaseId).toBe(returned.releaseId); expect(returned.initialSnapshot.stateHash).toBe(hashValue(returned.initialSnapshot.state));
  await page.getByRole("button", { name: publicOwn!, exact: true }).click({ button: "right" }); await page.getByRole("menuitem", { name: "Play to table", exact: true }).click(); await expect(page.locator(".hand-card")).toHaveCount(0);
  async function cardActions(player: Page) { await ready(player); const canvas = player.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true }); const box = await canvas.boundingBox(); if (!box) throw new Error("No rendered table canvas"); await canvas.click({ button: "right", position: { x: box.width / 2, y: box.height / 2 } }); return player.getByRole("menu", { name: "Object actions", exact: true }); }
  const hiddenActions = await cardActions(other); await expect(hiddenActions.locator("header strong")).toHaveText("Face-down card"); await hiddenActions.getByRole("menuitem", { name: "Inspect", exact: true }).click();
  await expect(other.getByRole("dialog", { name: "Inspecting Face-down card", exact: true })).toBeVisible(); await expect(other.getByRole("region", { name: "Full card rules", exact: true })).toHaveCount(0); await expect(other.locator('[data-card-face="designed-card"]')).toHaveCount(0); await capture(other, info, "scoped-hidden-back-no-fields.png"); await other.keyboard.press("Escape");
  const ownerActions = await cardActions(page); await ownerActions.getByRole("menuitem", { name: "Flip", exact: true }).click();
  const visibleActions = await cardActions(other); await visibleActions.getByRole("menuitem", { name: "Inspect", exact: true }).click(); await expect(other.getByRole("region", { name: "Full card rules", exact: true })).toContainText("FINAL PRINTED LINE."); await capture(other, info, "scoped-revealed-front-full-rules.png");
  } finally { await guest.close(); }
  } finally { await guestBrowser?.close(); }
});

test("a damaged saved family image blocks publication until explicit removal and remains available as an editable recovery", async ({ page }, info) => {
  test.setTimeout(180_000); await create(page); const first = await saved(page);
  const backup = await download(page, info, "valid.editor.json", async () => { const dialog = await artwork(page); await dialog.getByRole("button", { name: "Download editable draft", exact: true }).click(); }); await page.keyboard.press("Escape");
  const damaged = backup.value, file = damaged.bundle.files.find((f: any) => f.path === PATH); const doc = JSON.parse(file.content); doc.assets[0].artwork.info.sha256 = "sha256:" + "0".repeat(64); file.content = JSON.stringify(doc); file.byteLength = Buffer.byteLength(file.content); file.contentHash = "sha256:" + createHash("sha256").update(file.content).digest("hex");
  // Compute only the author's deliberate integrity-valid damaged-image input.
  const { releaseManifestHash } = await import("../packages/protocol/src/http"); const { hashValue } = await import("../packages/canonical-json/src/index"); damaged.bundle.integrity.manifestHash = releaseManifestHash(damaged.bundle, hashValue);
  damaged.artworkGeneration.cardJobs[0].job.status = "pending";
  let unexpectedArtRequests = 0; page.on("request", (request) => { if (request.url().endsWith("/api/ai/artwork") && request.method() === "POST") unexpectedArtRequests++; });
  const path = info.outputPath("damaged.editor.json"); await writeFile(path, JSON.stringify(damaged));
  await page.goto("/create"); await page.getByText("Upload an existing game · advanced", { exact: true }).click(); await page.getByLabel("Game JSON file", { exact: true }).setInputFiles(path); await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  await expect(page.getByRole("button", { name: /^Publish.*invite$/ })).toBeDisabled(); await expect(page.getByRole("alert")).toContainText("incomplete or changed"); await expect(page.getByRole("button", { name: "Draw card", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.locator(".hand-card")).toHaveCount(1); await capture(page, info, "damaged-card-image-publication-blocked.png");
  const art = await artwork(page); const editor = art.getByRole("region", { name: "Cards and decks", exact: true }); await editor.getByRole("button", { name: "Remove damaged card images", exact: true }).click(); await editor.getByRole("button", { name: "Save card designs", exact: true }).click(); await art.getByRole("button", { name: "Close game artwork", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Publish.*invite$/ })).toBeEnabled(); await expect(page.locator(".hand-card")).toHaveCount(1); expect((await saved(page)).bundle.initialSnapshot).toEqual(first.bundle.initialSnapshot); expect(unexpectedArtRequests).toBe(0); await capture(page, info, "card-image-deliberately-recovered.png");
});

test.describe("real touch authored cards", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("printed cards inspect and actually drop at short phone height without obscured controls", async ({ page }, info) => {
    test.setTimeout(150_000); await page.setViewportSize({ width: 390, height: 844 }); await create(page);
    await page.getByRole("button", { name: "Draw card", exact: true }).tap(); await expect(page.locator(".hand-card")).toHaveCount(1);
    await page.getByLabel("Draw from deck", { exact: true }).selectOption("reserve_deck"); await page.getByRole("button", { name: "Draw card", exact: true }).tap(); await expect(page.locator(".hand-card")).toHaveCount(2);
    await capture(page, info, "two-family-backs-touch-390.png");
    await page.setViewportSize({ width: 390, height: 480 }); await page.locator(".hand-card").first().tap();
    const close = page.getByRole("button", { name: "Close inspect", exact: true }); await expect(close).toBeInViewport();
    expect(await close.evaluate((b) => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; })).toBe(true);
    await expect(page.getByRole("region", { name: "Full card rules", exact: true })).toContainText("2 tokens"); await capture(page, info, "printed-inspection-touch-short.png"); await close.tap();
    const card = await page.locator(".hand-card").first().boundingBox(), canvas = await page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true }).boundingBox();
    if (!card || !canvas) throw new Error("The real hand or reserved canvas is missing");
    expect(canvas.height).toBeGreaterThan(95);
    const cdp = await page.context().newCDPSession(page), start = { x: card.x + card.width / 2, y: card.y + card.height / 2 }, end = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    for (let step = 1; step <= 14; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * step / 14, y: start.y + (end.y - start.y) * step / 14 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach(); await expect(page.locator(".hand-card")).toHaveCount(1); await capture(page, info, "authored-card-touch-drop-short.png");
    await page.setViewportSize({ width: 390, height: 844 }); await ready(page); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); await capture(page, info, "authored-card-after-touch-drop-390.png");
  });
});

test("a scoped illustration upload retains credit and original hash through quota recovery, editable backup and retry", async ({ page }, info) => {
  test.setTimeout(180_000); await create(page); const before = await saved(page); let requests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/ai/artwork") && request.method() === "POST") requests++; });
  await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.locator(".hand-card")).toHaveCount(1);
  const art = await artwork(page), editor = art.getByRole("region", { name: "Cards and decks", exact: true });
  await editor.getByLabel("Card family", { exact: true }).selectOption("main");
  await editor.getByRole("button", { name: "Family illustration…", exact: true }).click();
  const image = page.getByRole("dialog", { name: "Illustration for Main cards", exact: true });
  const input = new URL("../apps/web/public/art/zone-runner.webp", import.meta.url).pathname;
  await image.getByLabel("Image or saved artwork", { exact: true }).setInputFiles(input);
  await image.getByLabel("Artist / credit", { exact: true }).fill("Authorized raster transport fixture");
  await image.getByLabel("License / usage note", { exact: true }).fill("Technical verification only");
  await image.getByLabel("Public source page", { exact: true }).fill("https://github.com/Sanokei/digipology");
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as any).restoreCardStorage = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = function(key, value) { if (key.startsWith("dgp.editor.draft.")) throw new DOMException("Quota", "QuotaExceededError"); original.call(this, key, value); }; });
  await image.getByRole("button", { name: "Use illustration", exact: true }).click(); await expect(image.getByRole("alert")).toContainText("could not be saved");
  await page.setViewportSize({ width: 390, height: 480 }); await image.getByLabel("Public source page", { exact: true }).focus(); await expect(image.getByLabel("Public source page", { exact: true })).toBeInViewport(); await capture(page, info, "scoped-upload-quota-short.png");
  const backup = await download(page, info, "scoped-recovery.editor.json", () => image.getByRole("button", { name: "Download draft", exact: true }).click());
  const doc = designs(backup.value), selected = doc.assets.find((a) => a.id === doc.families.find((f) => f.id === "main")!.illustrationAssetId)!;
  expect(selected.original?.sha256).toBe("sha256:" + createHash("sha256").update(await readFile(input)).digest("hex")); expect(selected.original?.recipe).toContain("768x512");
  expect(selected.artwork.info.credits.artist).toBe("Authorized raster transport fixture"); expect(JSON.stringify(doc)).not.toContain('"source":{"name"');
  await page.evaluate(() => (window as any).restoreCardStorage()); await image.getByRole("button", { name: "Use illustration", exact: true }).click(); await expect(image).toHaveCount(0);
  await art.getByRole("button", { name: "Close game artwork", exact: true }).click(); await expect(page.locator(".hand-card")).toHaveCount(1);
  const restored = await saved(page); expect(designs(restored)).toEqual(doc); expect(restored.bundle.initialSnapshot).toEqual(before.bundle.initialSnapshot); expect(requests).toBe(0);
  await page.reload(); await ready(page); expect(designs(await saved(page))).toEqual(doc); await capture(page, info, "scoped-upload-recovered-390-short.png");
});
