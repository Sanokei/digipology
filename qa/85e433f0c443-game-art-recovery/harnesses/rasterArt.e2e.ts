import { test, expect, type Page, type TestInfo } from "./fixtures";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ReleaseBundleDto, OwnedGameDto } from "../packages/protocol/src/http";
import type { ArtworkGeneration, GeneratedArtwork } from "../packages/protocol/src/art-generation";
import type { ReadyDraftArtwork } from "../packages/protocol/src/artwork";
interface EditorDraft { id: string; title: string; artwork?: ReadyDraftArtwork; artworkGeneration?: ArtworkGeneration; generationReview?: { manifestHash: string }; bundle: ReleaseBundleDto }

// Existing authored rules and local raster HTTP fixtures exercise the real
// Worker/R2/processing/runtime path. They are not live creative output.
const BACK = "runtime/presentation/card-back.json";
const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(`raster-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json();
  await page.goto(link); await page.goto("/create");
}
async function create(page: Page, prompt: string) {
  await page.goto("/create");
  await page.getByLabel("Game description", { exact: true }).fill(prompt);
  const waiting = page.waitForResponse((response) => response.url().endsWith("/api/ai/games") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  const generated = await waiting; expect(generated.status()).toBe(200);
  const accepted = await generated.json();
  await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  return accepted;
}
async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator(".table-render-status")).toHaveCount(0);
}
async function saved(page: Page): Promise<EditorDraft> {
  return page.evaluate(() => {
    const id = decodeURIComponent(location.pathname.split("/").at(-1)!);
    return JSON.parse(localStorage.getItem(`dgp.editor.draft.${encodeURIComponent(id)}`)!);
  });
}
async function finished(page: Page) {
  await expect.poll(async () => {
    const draft = await saved(page);
    return draft.artworkGeneration?.jobs.cover.status === "ready" && draft.artworkGeneration.jobs.cardBack.status === "ready" && draft.generationReview?.manifestHash === draft.bundle.integrity.manifestHash;
  }, { timeout: 45_000 }).toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string) { await page.screenshot({ path: info.outputPath(name), fullPage: false }); }
async function download(page: Page, info: TestInfo, name: string, trigger: () => Promise<void>) {
  const pending = page.waitForEvent("download"); await trigger();
  const destination = info.outputPath(name); await (await pending).saveAs(destination);
  return new Uint8Array(await readFile(destination));
}
async function openArtwork(page: Page, title: string) {
  await page.getByRole("button", { name: "Edit artwork", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Artwork for ${title}`, exact: true });
  await expect(dialog.getByRole("button", { name: "Close game artwork", exact: true })).toBeFocused();
  return dialog;
}
async function menu(page: Page, action: string) {
  await page.locator(".editor-menu-dropdown > summary").filter({ hasText: /^File$/ }).click();
  await page.locator(".editor-menu-dropdown[open]").getByRole("button", { name: action }).click();
}

test("game-directed cover and back finish without resetting play, then survive publication, privacy and editable backup", async ({ page, browser }, info) => {
  test.setTimeout(240_000); await signIn(page);
  let releaseBack!: () => void;
  const backGate = new Promise<void>((resolve) => { releaseBack = resolve; });
  let waitingBack!: () => void;
  const backStarted = new Promise<void>((resolve) => { waitingBack = resolve; });
  let generationCalls = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/ai/games" && request.method() === "POST") generationCalls++; });
  await page.route("**/api/ai/artwork", async (route) => {
    if (route.request().postDataJSON().purpose !== "card-back") return route.continue();
    const response = await route.fetch(); waitingBack(); await backGate; await route.fulfill({ response });
  });
  try {
    const accepted = await create(page, "[raster-cards-fixture] Exercise separate game-authored cover and back transport.");
    await backStarted;
    await expect(page.locator("[data-card-back-state]")).toHaveAttribute("data-card-back-state", "pending");
    await expect(page.getByRole("button", { name: "Publish draft & invite", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Shuffle deck", exact: true }).click();
    await page.getByRole("button", { name: "Draw card", exact: true }).click();
    const hand = page.getByRole("button", { name: /^Inspect / }); await expect(hand).toHaveCount(1);
    const heldCard = await hand.getAttribute("aria-label");
    await capture(page, info, "pending-neutral-back-desktop.png");
    releaseBack(); await finished(page); await ready(page);
    const first = await saved(page), firstUrl = page.url();
    expect(first.artworkGeneration?.direction).toEqual(accepted.artDirection);
    expect(first.bundle.initialSnapshot).toEqual(accepted.draft.initialSnapshot);
    expect(first.bundle.files.filter((file) => file.path !== BACK)).toEqual(accepted.draft.files);
    expect(first.artworkGeneration?.jobs.cover.assetId).not.toBe(first.artworkGeneration?.jobs.cardBack.assetId);
    expect(first.artwork?.info.sha256).not.toBe(first.artworkGeneration?.jobs.cardBack.outputSha256);
    await expect(hand).toHaveCount(1); await expect(hand).toHaveAttribute("aria-label", heldCard!);
    await expect(page.locator("[data-card-back-key]")).toHaveAttribute("data-card-back-key", first.artworkGeneration!.jobs.cardBack.outputSha256!);
    await capture(page, info, "prepared-private-hand-desktop.png");
    let dialog = await openArtwork(page, first.title);
    await expect(dialog).toContainText("2 of 2 images ready");
    await expect(dialog).toContainText("Gameplay checks are up to date");
    await capture(page, info, "game-artwork-desktop.png");
    const backPanel = dialog.locator('[data-art-purpose="card-back"]');
    await expect.poll(async () => {
      const preview = await backPanel.locator(".game-art-asset__preview").boundingBox(), card = await backPanel.locator("canvas").boundingBox();
      return !!preview && !!card && card.x >= preview.x && card.y >= preview.y && card.x + card.width <= preview.x + preview.width && card.y + card.height <= preview.y + preview.height;
    }).toBe(true);
    await backPanel.getByText("Credits & original", { exact: true }).click();
    const originalBytes = await download(page, info, "card-back-original.webp", () => backPanel.getByRole("link", { name: "Download original image", exact: true }).click());
    expect(sha(originalBytes)).toBe(first.artworkGeneration!.jobs.cardBack.originalSha256!);
    const originalId = first.artworkGeneration!.jobs.cardBack.assetId!;
    const receipt = await (await page.request.get(`/api/ai/artwork/${originalId}/receipt`)).json();
    expect(receipt.request.direction).toEqual(accepted.artDirection);
    expect(receipt.renderPrompt).toContain(accepted.artDirection.cardBackPrompt);
    expect(receipt.dataUrl).toBeUndefined();
    await writeFile(info.outputPath("card-back-original.receipt.json"), JSON.stringify(receipt, null, 2));
    await page.setViewportSize({ width: 390, height: 844 });
    await backPanel.scrollIntoViewIfNeeded(); await capture(page, info, "game-artwork-390.png");
    await dialog.getByText("Edit the direction & image briefs", { exact: true }).click();
    await page.setViewportSize({ width: 390, height: 480 });
    const brief = dialog.getByLabel("Card-back brief", { exact: true }); await brief.focus();
    await brief.press("End"); await brief.press("Space");
    await expect.poll(async () => {
      const field = await brief.boundingBox(), footer = await dialog.locator("footer").boundingBox();
      return !!field && !!footer && field.y >= 0 && field.y + field.height <= footer.y;
    }).toBe(true);
    await capture(page, info, "game-artwork-field-short.png");
    await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: /Save direction/ })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await capture(page, info, "game-artwork-brief-short.png");
    const backupBytes = await download(page, info, "game-artwork.editor.json", () => dialog.getByRole("button", { name: "Download editable draft", exact: true }).click());
    const backup = JSON.parse(Buffer.from(backupBytes).toString("utf8"));
    expect(backup.artworkGeneration).toEqual(first.artworkGeneration);
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Edit artwork", exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 }); await ready(page); await capture(page, info, "prepared-private-hand-390.png");
    await page.getByRole("button", { name: "Publish & invite", exact: true }).click();
    await expect(page).toHaveURL(/\/table\//); await ready(page);
    if (info.project.name === "native-art") {
      const url = new URL(page.url()); url.searchParams.set("renderer", "lite"); await page.goto(url.href); await ready(page);
      await expect(page.locator(".renderer-override-chip")).toContainText("Renderer: lite");
    }
    const library = await (await page.request.get("/api/games/mine")).json() as { games: OwnedGameDto[] };
    const game = library.games.find((game) => game.title === first.title)!;
    const published = await (await page.request.get(`/api/releases/${game.latestReleaseId}/bundle`)).json();
    expect(published.files.find((file: { path: string }) => file.path === BACK)).toEqual(first.bundle.files.find((file) => file.path === BACK));
    expect(published.artworkGeneration).toBeUndefined(); expect(published.artwork).toBeUndefined();
    const coverInfo = await (await page.request.get(`/api/games/${game.slug}/cover-info?v=${game.coverVersion}`)).json();
    expect(coverInfo.artwork).toEqual(first.artwork!.info);
    const coverBytes = new Uint8Array(await (await page.request.get(`/api/games/${game.slug}/cover?v=${game.coverVersion}`)).body());
    expect(sha(coverBytes)).toBe(first.artwork!.info.sha256);
    await page.reload(); await ready(page); await capture(page, info, "published-artwork-390.png");
    const invite = await page.getByRole("button", { name: "Copy invite link", exact: true }).getAttribute("title");
    const guestContext = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 390, height: 844 } });
    try {
      const guest = await guestContext.newPage(); await guest.goto(invite!);
      await guest.getByLabel("Display name", { exact: true }).fill("Artwork guest");
      await guest.getByRole("button", { name: "Join table", exact: true }).click(); await ready(guest);
      expect((await guest.request.get(`/api/ai/artwork/${originalId}`)).status()).toBe(401);
      await page.bringToFront(); await page.getByRole("button", { name: "Shuffle deck", exact: true }).click(); await page.getByRole("button", { name: "Draw card", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1);
      await expect(guest.getByRole("button", { name: /^Inspect / })).toHaveCount(0);
      await ready(guest); await capture(guest, info, "published-guest-390.png");
    } finally { await guestContext.close(); }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(firstUrl.replace("/playtest/", "/edit/"));
    const reopened = await download(page, info, "reopened-artwork.editor.json", () => menu(page, "Download editable draft"));
    expect(JSON.parse(Buffer.from(reopened).toString("utf8")).artworkGeneration).toEqual(first.artworkGeneration);
    const releaseBytes = await download(page, info, "game-artwork.release.json", () => menu(page, "Export release bundle"));
    const exported = JSON.parse(Buffer.from(releaseBytes).toString("utf8"));
    expect(exported.artworkGeneration).toBeUndefined(); expect(exported.generationRequest).toBeUndefined();
    expect(exported.files.find((file: { path: string }) => file.path === BACK)).toEqual(first.bundle.files.find((file) => file.path === BACK));
    await create(page, "[raster-cards-fixture] [night-art-fixture] Exercise another independent game's art direction.");
    await finished(page); const second = await saved(page);
    expect(second.artworkGeneration?.direction).not.toEqual(first.artworkGeneration?.direction);
    expect(second.artworkGeneration?.jobs.cardBack.assetId).not.toBe(originalId);
    expect(second.artworkGeneration?.jobs.cardBack.outputSha256).not.toBe(first.artworkGeneration?.jobs.cardBack.outputSha256);
    expect(sha(new Uint8Array(await (await page.request.get(`/api/games/${game.slug}/cover?v=${game.coverVersion}`)).body()))).toBe(first.artwork!.info.sha256);
    expect((await (await page.request.get(`/api/releases/${game.latestReleaseId}/bundle`)).json()).files).toEqual(published.files);
    dialog = await openArtwork(page, second.title); await capture(page, info, "second-game-artwork-desktop.png");
    expect(generationCalls).toBe(2);
    await writeFile(info.outputPath("artwork-roundtrip.json"), JSON.stringify({ fixtureScope: "Existing authored First Deal rules + explicit local raster HTTP fixtures; no live creative output or artwork-quality acceptance", firstDirection: first.artworkGeneration?.direction, secondDirection: second.artworkGeneration?.direction, firstJobs: first.artworkGeneration?.jobs, secondJobs: second.artworkGeneration?.jobs, actualRasterDecode: true, canonicalInitialStatePreserved: true, inProgressHandPreserved: true, originalAndPublishedHashVerified: true, oldReleasePreserved: true, ownerOnlyHandPresentation: true, modelGameRequests: generationCalls }, null, 2));
  } finally { releaseBack(); }
});

test("blank replacements retain selected originals and retry only artwork; interrupted replies reuse stored results", async ({ page }, info) => {
  test.setTimeout(180_000); await signIn(page);
  let gameCalls = 0, imageCalls = 0;
  page.on("request", (request) => { const path = new URL(request.url()).pathname; if (path === "/api/ai/games" && request.method() === "POST") gameCalls++; if (path === "/api/ai/artwork" && request.method() === "POST") imageCalls++; });
  await create(page, "[raster-cards-fixture] Exercise recovery with actual prepared fixture images.");
  await finished(page); const before = await saved(page);
  let dialog = await openArtwork(page, before.title);
  await dialog.getByText("Edit the direction & image briefs", { exact: true }).click();
  await dialog.getByLabel("Card-back brief", { exact: true }).fill(before.artworkGeneration!.direction!.cardBackPrompt + " [blank-first]");
  await dialog.getByRole("button", { name: "Save direction & create changed images", exact: true }).click();
  const back = dialog.locator('[data-art-purpose="card-back"]');
  await expect(back.getByRole("alert")).toContainText("blank or invisible", { timeout: 30_000 });
  const failed = await saved(page);
  expect(failed.artworkGeneration!.jobs.cardBack.selectedAssetId).toBe(before.artworkGeneration!.jobs.cardBack.assetId);
  expect(failed.artworkGeneration!.jobs.cardBack.assetId).not.toBe(before.artworkGeneration!.jobs.cardBack.assetId);
  expect(failed.bundle.files.find((file) => file.path === BACK)).toEqual(before.bundle.files.find((file) => file.path === BACK));
  expect(failed.artwork).toEqual(before.artwork);
  await back.getByText("Credits & original", { exact: true }).click();
  const selected = await download(page, info, "selected-original-after-failure.webp", () => back.getByRole("link", { name: "Download original image", exact: true }).click());
  const attempted = await download(page, info, "rejected-blank-attempt.png", () => back.getByRole("link", { name: "Download attempted original", exact: true }).click());
  expect(sha(selected)).toBe(before.artworkGeneration!.jobs.cardBack.originalSha256!);
  expect(sha(attempted)).toBe(failed.artworkGeneration!.jobs.cardBack.originalSha256!);
  await capture(page, info, "blank-replacement-keeps-selected-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 }); await back.scrollIntoViewIfNeeded(); await capture(page, info, "blank-replacement-keeps-selected-390.png");
  const beforeRetry = imageCalls;
  await back.getByRole("button", { name: "Retry card back", exact: true }).click(); await finished(page);
  const recovered = await saved(page);
  expect(recovered.artworkGeneration!.jobs.cardBack.revision).toBe(failed.artworkGeneration!.jobs.cardBack.revision + 1);
  expect(recovered.artwork).toEqual(before.artwork); expect(imageCalls - beforeRetry).toBe(1); expect(gameCalls).toBe(1);
  await capture(page, info, "artwork-recovered-390.png");
  // Drop one response only after the real Worker has stored its original in R2.
  let dropped: GeneratedArtwork | undefined;
  await page.route("**/api/ai/artwork", async (route) => {
    if (route.request().postDataJSON().purpose !== "cover" || dropped) return route.continue();
    const response = await route.fetch(); dropped = await response.json(); await route.abort("failed");
  });
  const cover = dialog.locator('[data-art-purpose="cover"]');
  await cover.getByRole("button", { name: "Create another cover", exact: true }).click();
  await expect(cover.getByRole("alert")).toBeVisible();
  await expect.poll(async () => (await saved(page)).artworkGeneration!.jobs.cover.status).toBe("failed");
  const metricsBefore = await (await page.request.get("http://127.0.0.1:8795/metrics")).json();
  await cover.getByRole("button", { name: "Retry cover", exact: true }).click(); await finished(page);
  expect((await saved(page)).artworkGeneration!.jobs.cover.assetId).toBe(dropped!.assetId);
  const metricsAfter = await (await page.request.get("http://127.0.0.1:8795/metrics")).json();
  expect(metricsAfter.imageRequests).toHaveLength(metricsBefore.imageRequests.length);
  expect(gameCalls).toBe(1);
  await writeFile(info.outputPath("recovery.json"), JSON.stringify({ fixtureScope: "Controlled blank raster + lost HTTP reply after real local R2 write; not live generation", selectedOriginal: before.artworkGeneration!.jobs.cardBack, failedAttempt: failed.artworkGeneration!.jobs.cardBack, recovered: recovered.artworkGeneration!.jobs.cardBack, completedCoverReused: dropped!.assetId, gameRequests: gameCalls }, null, 2));
});

test("browser quota failure keeps prepared artwork downloadable and saves it without another provider operation", async ({ page }, info) => {
  test.setTimeout(150_000); await signIn(page);
  let imageCalls = 0, gameCalls = 0;
  page.on("request", (request) => { const path = new URL(request.url()).pathname; if (path === "/api/ai/artwork" && request.method() === "POST") imageCalls++; if (path === "/api/ai/games" && request.method() === "POST") gameCalls++; });
  await page.route("**/api/ai/artwork", async (route) => {
    if (route.request().postDataJSON().purpose !== "card-back") return route.continue();
    const response = await route.fetch();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as unknown as { restoreArtStorage(): void }).restoreArtStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function(key: string, value: string) {
        if (key.startsWith("dgp.editor.draft.") && JSON.parse(value).artworkGeneration?.jobs.cardBack.status === "ready") throw new DOMException("Controlled browser quota failure", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    await route.fulfill({ response });
  });
  const accepted = await create(page, "[raster-cards-fixture] Exercise prepared artwork storage recovery.");
  const dialog = await openArtwork(page, accepted.draft.title);
  const back = dialog.locator('[data-art-purpose="card-back"]');
  await expect(back).toContainText("Needs saving", { timeout: 30_000 });
  await expect(dialog.getByText(/browser storage could not save it/)).toBeVisible();
  const bytes = await download(page, info, "unsaved-prepared-artwork.editor.json", () => dialog.getByRole("button", { name: "Download editable draft", exact: true }).click());
  const backup = JSON.parse(Buffer.from(bytes).toString("utf8"));
  expect(backup.artworkGeneration.jobs.cardBack.failureKind).toBe("storage");
  expect(backup.artworkGeneration.jobs.cardBack.selectedAssetId).toBe(backup.artworkGeneration.jobs.cardBack.assetId);
  expect(backup.bundle.files.some((file: { path: string }) => file.path === BACK)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("button", { name: "Retry saving draft", exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, "artwork-storage-recovery-390.png");
  expect(imageCalls).toBe(2); expect(gameCalls).toBe(1);
  await page.evaluate(() => (window as unknown as { restoreArtStorage(): void }).restoreArtStorage());
  await dialog.getByRole("button", { name: "Retry saving draft", exact: true }).click(); await finished(page);
  expect(imageCalls).toBe(2); expect(gameCalls).toBe(1);
  const recovered = await saved(page);
  expect(recovered.bundle.files.find((file) => file.path === BACK)).toEqual(backup.bundle.files.find((file: { path: string }) => file.path === BACK));
  expect(recovered.artworkGeneration!.jobs.cardBack.assetId).toBe(backup.artworkGeneration.jobs.cardBack.assetId);
  await page.keyboard.press("Escape"); await page.reload(); await ready(page);
  await expect(page.locator("[data-card-back-state]")).toHaveAttribute("data-card-back-state", "ready");
  await capture(page, info, "artwork-storage-recovered-390.png");
});

test("unconfigured illustration preserves the playable rules and separate briefs without sample artwork", async ({ page }, info) => {
  test.setTimeout(90_000); await signIn(page);
  let gameCalls = 0, imageCalls = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/ai/games" && request.method() === "POST") gameCalls++; });
  await page.route("**/api/ai/artwork", (route) => {
    imageCalls++;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "artwork_unconfigured", message: "Illustration is unavailable on this server. Your rules are saved. Retry artwork later or replace the images." } }) });
  });
  const accepted = await create(page, "[raster-cards-fixture] Exercise the missing-image-provider interface without stock substitution.");
  await expect.poll(async () => {
    const jobs = (await saved(page)).artworkGeneration!.jobs;
    return jobs.cover.status === "unconfigured" && jobs.cardBack.status === "unconfigured";
  }).toBe(true);
  await expect(page.locator("[data-card-back-state]")).toHaveAttribute("data-card-back-state", "pending");
  await expect(page.getByRole("button", { name: "Publish draft & invite", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Draw card", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1);
  const dialog = await openArtwork(page, accepted.draft.title);
  await expect(dialog).toContainText("0 of 2 images ready");
  await expect(dialog.locator(".game-art-asset__state")).toHaveText(["Waiting for image access", "Waiting for image access"]);
  expect(await dialog.locator(".game-art-assets img, .game-art-assets canvas").count()).toBe(0);
  const bytes = await download(page, info, "missing-provider.editor.json", () => dialog.getByRole("button", { name: "Download editable draft", exact: true }).click());
  const backup = JSON.parse(Buffer.from(bytes).toString("utf8"));
  expect(backup.bundle).toEqual(accepted.draft); expect(backup.artworkGeneration.direction).toEqual(accepted.artDirection); expect(backup.artwork).toBeUndefined();
  await dialog.locator('[data-art-purpose="card-back"]').getByRole("button", { name: "Replace image…", exact: true }).click();
  const emptyEditor = page.locator(".artwork-dialog");
  const emptyBackup = await download(page, info, "empty-image-editor.editor.json", () => emptyEditor.getByRole("button", { name: "Download draft", exact: true }).click());
  expect(JSON.parse(Buffer.from(emptyBackup).toString("utf8"))).toEqual(backup);
  await page.setViewportSize({ width: 390, height: 480 });
  await expect(emptyEditor.getByRole("button", { name: "Download draft", exact: true })).toBeInViewport();
  await capture(page, info, "empty-card-artwork-backup-short.png");
  await page.keyboard.press("Escape"); await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, info, "image-provider-unavailable-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  const cover = dialog.locator('[data-art-purpose="cover"]');
  await cover.getByRole("button", { name: "Retry cover", exact: true }).click();
  await expect.poll(() => imageCalls).toBe(3); expect(gameCalls).toBe(1);
  await cover.scrollIntoViewIfNeeded(); await capture(page, info, "image-provider-unavailable-390.png");
  await writeFile(info.outputPath("missing-provider-scope.json"), JSON.stringify({ scope: "Controlled HTTP artwork_unconfigured response after actual fixture rules acceptance; handler configuration is tested separately. No image port/model invoked and no stock image installed.", gameCalls, imageCalls, canonicalInitialStatePreserved: true, imageBriefsPreserved: true, privateDrawStillWorks: true }, null, 2));
});
