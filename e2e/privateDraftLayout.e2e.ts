import { test, expect, type Page, type TestInfo } from "./fixtures";
import { readFile, writeFile } from "node:fs/promises";

// Existing deterministic rule/image ports, not live generated art or fun evidence.
async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator(".table-render-status")).toHaveCount(0);
}
async function saved(page: Page) {
  return page.evaluate(() => {
    const id = decodeURIComponent(location.pathname.split("/").at(-1)!);
    return JSON.parse(localStorage.getItem(`dgp.editor.draft.${encodeURIComponent(id)}`)!);
  });
}
async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(`layout-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json();
  await page.goto(link); await page.goto("/create");
}
async function create(page: Page, prompt: string) {
  await signIn(page);
  await page.getByLabel("Game description", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  await expect(page.getByRole("button", { name: "Publish & invite", exact: true })).toBeEnabled({ timeout: 45_000 });
}
async function surface(page: Page, minimumHeight: number) {
  await ready(page);
  await expect.poll(() => page.evaluate((minimum) => {
    const root = document.querySelector(".draft-play-scene")!;
    const canvas = root.querySelector("canvas")!;
    const c = canvas.getBoundingClientRect();
    const top = root.querySelector(".draft-play-top")!.getBoundingClientRect();
    const dock = root.querySelector(".table-bottom-dock")!.getBoundingClientRect();
    return c.height >= minimum && c.top >= top.bottom + 6 && c.bottom <= dock.top - 6 && c.left >= 0 && c.right <= innerWidth && document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2) === canvas;
  }, minimumHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByRole("button", { name: "Edit artwork", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: /^Publish.*invite$/ })).toBeInViewport();
}
async function capture(page: Page, info: TestInfo, name: string) {
  // Settle the resized first frame; geometry alone is not a rendered-table pass.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: info.outputPath(name), fullPage: false });
}
async function tools(page: Page) {
  await page.getByRole("button", { name: "Playtest tools", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Playtest tools", exact: true });
  await expect(dialog.getByRole("button", { name: "Close playtest tools", exact: true })).toBeFocused();
  return dialog;
}

test("private dice draft keeps actual table clear through roll, tools, short resize and explicit artwork repair", async ({ page }, info) => {
  test.setTimeout(180_000);
  await create(page, "[review-warning] Exercise the existing dice fixture for private viewport and recovery checks.");
  const initial = await saved(page), progress = page.getByRole("complementary", { name: "Game progress", exact: true });
  await surface(page, 400); await capture(page, info, "dice-desktop-settled.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await surface(page, 400);
  const before = await progress.getByRole("status").innerText();
  await page.getByRole("button", { name: "Roll Die", exact: true }).click();
  await expect(progress.getByRole("status")).not.toHaveText(before);
  const scores = await progress.locator("li strong").allTextContents();
  expect(Number(scores[0])).toBe(Number(await page.getByLabel("Die result", { exact: true }).innerText()));
  await capture(page, info, "dice-390-roll-feedback.png");
  let dialog = await tools(page);
  await page.getByLabel("Playtest player count", { exact: true }).selectOption("3");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Playtest tools", exact: true })).toBeFocused();
  await expect(progress.locator("li strong")).toHaveText(scores);
  await page.setViewportSize({ width: 390, height: 480 });
  await surface(page, 180); await capture(page, info, "dice-short-settled.png");
  dialog = await tools(page);
  await expect(dialog.getByLabel("Playtest player count", { exact: true })).toHaveValue("3");
  await expect(dialog.getByRole("button", { name: "Close playtest tools", exact: true })).toBeInViewport();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Back to table", exact: true })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Back to table", exact: true })).toBeInViewport();
  await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "Close playtest tools", exact: true })).toBeFocused();
  await dialog.getByLabel("Play as", { exact: true }).selectOption({ label: "Player 2" });
  await dialog.getByLabel("Playtest player count", { exact: true }).selectOption("2");
  await capture(page, info, "tools-short-keyboard.png");
  const pending = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Download editable draft", exact: true }).click();
  const path = info.outputPath("tools-backup.editor.json"); await (await pending).saveAs(path);
  const backup = JSON.parse(await readFile(path, "utf8"));
  expect(backup.bundle).toEqual(initial.bundle); expect(backup.artwork).toEqual(initial.artwork);
  await dialog.getByRole("button", { name: "Close playtest tools", exact: true }).click();
  await surface(page, 180);
  await expect(progress.locator("li strong")).toHaveText(scores);
  await page.getByRole("button", { name: "Roll Die", exact: true }).click();
  await expect(progress.locator("li strong").nth(1)).not.toHaveText("0");
  await page.getByRole("button", { name: "Edit artwork", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close game artwork", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Edit artwork", exact: true })).toBeFocused();
  expect((await saved(page)).bundle).toEqual(initial.bundle);
  // Reload deliberately resets the playtest; damaged cover must survive as a repair task.
  await page.evaluate(() => {
    const id = decodeURIComponent(location.pathname.split("/").at(-1)!);
    const key = `dgp.editor.draft.${encodeURIComponent(id)}`, draft = JSON.parse(localStorage.getItem(key)!);
    draft.artwork = { status: "ready", dataUrl: "data:image/png;base64,broken", info: { formatVersion: 1 } };
    draft.artworkGeneration.jobs.cover.status = "running"; localStorage.setItem(key, JSON.stringify(draft));
  });
  let repairRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/ai/artwork") repairRequests++; });
  await page.reload(); await surface(page, 180);
  await expect(page.getByRole("button", { name: "Publish draft & invite", exact: true })).toBeDisabled();
  expect(repairRequests).toBe(0);
  await page.getByRole("button", { name: "Edit artwork", exact: true }).click();
  const cover = page.locator('.game-art-asset[data-art-purpose="cover"]');
  await cover.getByRole("alert").scrollIntoViewIfNeeded();
  await capture(page, info, "art-repair-short.png");
  await cover.getByRole("button", { name: "Retry cover", exact: true }).click();
  await expect(cover.locator(".game-art-asset__state")).toHaveText("Ready");
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish & invite", exact: true })).toBeEnabled();
  expect(repairRequests).toBe(1);
  await surface(page, 180); await capture(page, info, "dice-short-repair-recovered.png");
  await page.setViewportSize({ width: 390, height: 844 }); await surface(page, 400); await capture(page, info, "dice-390-repair-recovered.png");
  await writeFile(info.outputPath("scope.json"), JSON.stringify({ fixture: true, genuineGeneration: false, providerConfigured: false, layoutPreservesRunningScores: true, canonicalInitialBundlePreserved: true, noAutomaticDamagedCoverReplacement: true, deliberateRepairRequests: repairRequests }, null, 2));
});

test.describe("touch phone input", () => {
  test.use({ hasTouch: true, isMobile: true });

test("private card draft reserves a phone table and keeps hand inspection and drop coordinates after resize", async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, "[raster-cards-fixture] Exercise existing card rules and explicit raster ports for private viewport checks.");
  const initial = await saved(page);
  await surface(page, 350);
  await page.getByRole("button", { name: "Draw card", exact: true }).click();
  await page.getByRole("button", { name: "Draw card", exact: true }).click();
  const cards = page.getByRole("button", { name: /^Inspect / }); await expect(cards).toHaveCount(2);
  const labels = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  await surface(page, 300); await capture(page, info, "cards-390-private-hand.png");
  await tools(page); await page.keyboard.press("Escape"); await expect(cards).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 480 }); await surface(page, 100);
  expect(await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).toEqual(labels);
  await cards.first().tap(); await expect(page.getByRole("dialog", { name: /^Inspecting / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close inspect", exact: true })).toBeInViewport();
  await expect.poll(() => page.getByRole("button", { name: "Close inspect", exact: true }).evaluate((button) => {
    const r = button.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === button;
  })).toBe(true);
  await capture(page, info, "card-inspection-short.png"); await page.keyboard.press("Escape"); await expect(cards.first()).toBeFocused();
  await capture(page, info, "cards-short-settled.png");
  const canvas = await page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true }).boundingBox(), card = await cards.first().boundingBox();
  if (!canvas || !card) throw new Error("No visible hand or table");
  const touch = await page.context().newCDPSession(page);
  const start = { x: card.x + card.width / 2, y: card.y + card.height / 2 }, end = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let step = 1; step <= 14; step++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * step / 14, y: start.y + (end.y - start.y) * step / 14 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await touch.detach();
  await expect(cards).toHaveCount(1); // Real grab/drop through the offset canvas projector.
  await surface(page, 100); await capture(page, info, "card-drop-short.png");
  await page.setViewportSize({ width: 1440, height: 960 }); await surface(page, 500); await expect(cards).toHaveCount(1);
  await capture(page, info, "cards-desktop-after-drop.png");
  expect((await saved(page)).bundle.initialSnapshot).toEqual(initial.bundle.initialSnapshot);
});

test("private long Lua status stays readable and keyboard-scrollable with discoverable camera help", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  // Same saved dice fixture and rules; only its actual Lua status copy is longer.
  // Normal import/integrity/runtime paths exercise this host-authored UI variation.
  const draft = JSON.parse(await readFile("e2e/fixtures/raster-draft.editor.json", "utf8"));
  const title = "Long instructions in an existing local dice layout fixture";
  const message = "Choose your next roll carefully, then read every player's score before handing over the turn. ".repeat(10);
  const script = draft.bundle.files.find((file: { path: string }) => file.path === "scripts/game.lua")!;
  const needle = 'refs.status:set(current.name .. " — roll to race to " .. settings.targetScore)';
  expect(script.content).toContain(needle);
  const edited = script.content.replace(needle, `refs.status:set(current.name .. ${JSON.stringify(" — " + message)})`);
  // Author through the supported desktop editor, then use its real editable backup
  // in the touch browser; do not bypass the mobile editor's desktop requirement.
  const desktop = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 1440, height: 960 }, isMobile: false, hasTouch: false });
  const backupPath = info.outputPath("long-status.editor.json");
  try {
    const author = await desktop.newPage(); await author.goto(`/edit/long-status-${Date.now()}`);
    async function menu(heading: string, action: string) {
      await author.locator(".editor-menu-dropdown > summary").filter({ hasText: new RegExp(`^${heading}$`) }).click();
      await author.locator(".editor-menu-dropdown[open]").getByRole("button", { name: action }).click();
    }
    const choosing = author.waitForEvent("filechooser"); await menu("File", "Import draft or bundle…");
    await (await choosing).setFiles("e2e/fixtures/raster-draft.editor.json");
    await expect(author.locator(".editor-details-bar").getByLabel("Title", { exact: true })).toHaveValue(draft.title);
    await menu("Window", "Lua IDE");
    await author.getByLabel("Lua IDE", { exact: true }).locator('.cm-content[contenteditable="true"]').fill(edited);
    await author.locator(".editor-details-bar").getByLabel("Title", { exact: true }).fill(title); await author.keyboard.press("Enter");
    const downloading = author.waitForEvent("download"); await menu("File", "Download editable draft"); await (await downloading).saveAs(backupPath);
  } finally { await desktop.close(); }
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  expect(backup.bundle.files.find((file: { path: string }) => file.path === script.path).content).toBe(edited);
  await page.setViewportSize({ width: 390, height: 480 }); await signIn(page);
  await page.locator("summary").filter({ hasText: "Upload an existing game" }).click();
  await page.getByLabel("Game JSON file", { exact: true }).setInputFiles(backupPath);
  await expect(page).toHaveURL(/\/playtest\//); await ready(page);
  const status = page.getByRole("complementary", { name: "Game progress", exact: true }).getByRole("status");
  await expect(status).toContainText(message);
  await expect(status).toHaveAttribute("tabindex", "0");
  expect(await status.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await status.focus(); await status.press("End"); await expect.poll(() => status.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await surface(page, 120); await capture(page, info, "long-status-short-scrolled.png");
  const dialog = await tools(page);
  const help = dialog.getByRole("region", { name: "Table controls", exact: true });
  await help.scrollIntoViewIfNeeded(); await expect(help).toContainText("pinch to zoom");
  await expect(dialog.locator(".draft-play-tools__touch-help")).toBeVisible();
  await expect(dialog.locator(".draft-play-tools__pointer-help")).toBeHidden();
  await capture(page, info, "tools-camera-help-short.png");
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Playtest tools", exact: true })).toBeFocused();
  await surface(page, 120);
});

});
