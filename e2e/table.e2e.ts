import { test, expect, type Browser, type Page, type WebSocketRoute } from "@playwright/test";

async function renderedTable(page: Page) {
  await page.bringToFront();
  // Two visible software-rendered browser contexts share one CPU/GPU process
  // in CI. Keep asserting actual frames, with the normal navigation budget.
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
}

async function host(page: Page, slug: string, waitForRender = true) {
  await page.goto("/");
  await page.getByRole("button", { name: /host a room/i }).first().click();
  await page.getByLabel("Game", { exact: true }).selectOption(slug);
  await page.getByLabel("Display name", { exact: true }).fill("Alex");
  await page.getByRole("button", { name: "Create table", exact: true }).click();
  const invite = await page.getByLabel("Invite URL", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Enter table", exact: true }).click();
  await page.getByRole("img", { name: "Live synchronized 3D tabletop" }).waitFor();
  if (waitForRender) await renderedTable(page);
  await expect(page.getByRole("button", { name: "Show 1 player", exact: true })).toBeVisible();
  return new URL(invite).pathname;
}

async function guest(browser: Browser, invite: string) {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(invite);
  await page.getByLabel("Display name", { exact: true }).fill("Sam");
  await page.getByRole("button", { name: "Join table", exact: true }).click();
  await page.getByRole("img", { name: "Live synchronized 3D tabletop" }).waitFor();
  await renderedTable(page);
  return { context, page };
}

test("two people play Dice Dash to a winner, hear feedback, and retain the finished game after reload", async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  const wasmHosts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.includes("glue-") && url.pathname.endsWith(".wasm")) wasmHosts.push(url.host); });
  await page.addInitScript(() => {
    const starts: number[] = [];
    (window as unknown as { __audioStarts: number[] }).__audioStarts = starts;
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<AudioBufferSourceNode["start"]>) {
      starts.push(this.buffer?.length ?? 0);
      return original.apply(this, args);
    };
  });
  const invite = await host(page, "dice-dash");
  const other = await guest(browser, invite);
  other.page.on("pageerror", (error) => errors.push(error.message));
  try {
    const panels = [page.getByRole("complementary", { name: "Game progress" }), other.page.getByRole("complementary", { name: "Game progress" })];
    await expect(page.getByRole("button", { name: "Show 2 players", exact: true })).toBeVisible();
    await expect(other.page.getByRole("button", { name: "Show 2 players", exact: true })).toBeVisible();
    for (const playerPage of [page, other.page]) {
      const roster = playerPage.getByRole("complementary", { name: "Players", exact: true });
      await expect(roster.locator("strong")).toHaveText(["Alex", "Sam"]);
      await expect(roster.locator("em")).toHaveText(["Connected", "Connected"]);
    }
    await expect(panels[0]!.getByRole("listitem")).toHaveCount(2);
    let turns = 0;
    for (; turns < 40; turns += 1) {
      if ((await panels[0]!.getByRole("status").innerText()).includes("wins Dice Dash!")) break;
      const current = await page.getByRole("button", { name: "Roll Die", exact: true }).isEnabled() ? page : other.page;
      await current.bringToFront();
      const waiting = current === page ? other.page : page;
      await expect(waiting.getByRole("button", { name: "Roll Die", exact: true })).toBeDisabled();
      const before = await panels[0]!.innerText();
      await current.getByRole("button", { name: "Roll Die", exact: true }).click();
      await expect.poll(() => panels[0]!.innerText()).not.toBe(before);
      await expect(panels[1]!.getByRole("status")).toHaveText(await panels[0]!.getByRole("status").innerText());
      await expect(panels[1]!.locator("li strong")).toHaveText(await panels[0]!.locator("li strong").allTextContents());
    }
    expect(turns).toBeGreaterThan(1);
    expect(turns).toBeLessThan(40);
    await expect(panels[0]!.getByRole("status")).toContainText("wins Dice Dash!");
    await expect(page.getByRole("button", { name: "Roll Die", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => (window as unknown as { __audioStarts: number[] }).__audioStarts.filter((length) => length > 0).length)).toBeGreaterThan(0);
    await page.getByLabel("Sound settings", { exact: true }).click();
    await page.getByRole("button", { name: "Mute sound", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unmute sound", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: testInfo.outputPath("finished-game.png"), fullPage: true });
    await page.reload();
    await expect(page.getByRole("complementary", { name: "Game progress" }).getByRole("status")).toContainText("wins Dice Dash!");
    await renderedTable(page);
    await expect(other.page.getByRole("complementary", { name: "Players", exact: true }).locator("em")).toHaveText(["Connected", "Connected"]);
    await page.screenshot({ path: testInfo.outputPath("finished-game-restored.png"), fullPage: true });
    await page.getByLabel("Sound settings", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Unmute sound", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
    expect(wasmHosts.length).toBeGreaterThan(0);
    expect(wasmHosts.every((host) => host === "127.0.0.1:8797")).toBe(true);
  } finally { await other.context.close(); }
});

test("named cards remain private in hands, play visibly to the table, reveal and survive reload", async ({ page, browser }, testInfo) => {
  const invite = await host(page, "first-deal");
  const other = await guest(browser, invite);
  try {
    await expect(page.getByRole("button", { name: "Draw card", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Shuffle deck", exact: true }).click();
    await page.getByRole("button", { name: "Draw card", exact: true }).click();
    await expect(page.getByRole("button", { name: "Inspect 7 of Diamonds", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Draw card", exact: true }).click();
    await expect(page.getByRole("button", { name: "Inspect Queen of Clubs", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(2);
    await expect(other.page.getByText("Your hand is empty", { exact: true })).toBeVisible();
    await expect(other.page.getByRole("button", { name: /^Inspect / })).toHaveCount(0);
    await expect(other.page.getByText("7 of Diamonds", { exact: true })).toHaveCount(0);
    await other.page.screenshot({ path: testInfo.outputPath("card-hand-guest-private.png"), fullPage: true });
    await page.bringToFront();
    await page.getByRole("button", { name: "Inspect 7 of Diamonds", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Inspecting 7 of Diamonds", exact: true })).toBeVisible();
    // The same full raster face is used in the hand, inspector and 3D table.
    const inspectedFace = page.locator(".inspect-overlay__preview .playing-card[data-card-face='standard-card'] canvas");
    await expect(inspectedFace).toBeVisible();
    await expect(inspectedFace).toHaveAttribute("width", "512");
    await expect(inspectedFace).toHaveAttribute("height", "736");
    expect(await inspectedFace.evaluate((element) => {
      const ctx = (element as HTMLCanvasElement).getContext("2d")!;
      const pixels = ctx.getImageData(0, 0, 512, 736).data;
      let redInk = 0;
      for (let at = 0; at < pixels.length; at += 4) if (pixels[at]! > pixels[at + 1]! * 1.5 && pixels[at + 3]! > 200) redInk++;
      return redInk;
    })).toBeGreaterThan(8000);
    await page.screenshot({ path: testInfo.outputPath("card-inspection.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "Inspect 7 of Diamonds", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Play to table", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1);
    async function centerCardActions(playerPage: Page) {
      await playerPage.bringToFront();
      const canvas = playerPage.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true });
      const box = await canvas.boundingBox();
      if (!box) throw new Error("No visible table canvas");
      await canvas.click({ button: "right", position: { x: box.width / 2, y: box.height / 2 } });
      return playerPage.getByRole("menu", { name: "Object actions", exact: true });
    }
    const privateBack = await centerCardActions(other.page);
    await expect(privateBack.locator("header strong")).toHaveText("Face-down card");
    await privateBack.getByRole("menuitem", { name: "Inspect", exact: true }).click();
    await expect(other.page.getByRole("dialog", { name: "Inspecting Face-down card", exact: true })).toBeVisible();
    await expect(other.page.locator(".inspect-overlay__preview .playing-card[data-card-face='card-back'] canvas")).toBeVisible();
    await expect(other.page.locator(".inspect-overlay__preview [data-card-face='standard-card'], .inspect-overlay__preview [data-card-face='custom-card']")).toHaveCount(0);
    await expect(other.page.getByText("7 of Diamonds", { exact: true })).toHaveCount(0);
    await other.page.screenshot({ path: testInfo.outputPath("played-card-hidden-face.png"), fullPage: true });
    await other.page.keyboard.press("Escape");
    const ownerActions = await centerCardActions(page);
    await expect(ownerActions.locator("header strong")).toHaveText("Face-down card");
    await ownerActions.getByRole("menuitem", { name: "Flip", exact: true }).click();
    const revealed = await centerCardActions(other.page);
    await expect(revealed.locator("header strong")).toHaveText("7 of Diamonds");
    await revealed.getByRole("menuitem", { name: "Inspect", exact: true }).click();
    await expect(other.page.getByRole("dialog", { name: "Inspecting 7 of Diamonds", exact: true })).toBeVisible();
    await other.page.screenshot({ path: testInfo.outputPath("played-card-revealed.png"), fullPage: true });
    await page.reload();
    await expect(page.getByRole("button", { name: "Inspect Queen of Clubs", exact: true })).toBeVisible();
    await renderedTable(page);
    await page.screenshot({ path: testInfo.outputPath("card-hand-restored.png"), fullPage: true });
    await page.getByRole("button", { name: "Inspect Queen of Clubs", exact: true }).click();
    await expect(page.locator(".inspect-overlay__preview .playing-card canvas")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("court-card-desktop.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 480 });
    await expect(page.getByRole("button", { name: "Close inspect", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("court-card-short.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Inspect Queen of Clubs", exact: true })).toBeFocused();
  } finally { await other.context.close(); }
});

test("mobile table keeps play controls reachable without horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await host(page, "dice-dash");
  await expect(page.getByRole("button", { name: "Roll Die", exact: true })).toBeEnabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  const title = await page.locator(".table-topbar__game strong").boundingBox();
  const actions = await page.locator(".table-topbar__actions").boundingBox();
  if (!title || !actions) throw new Error("Missing mobile header controls");
  expect(title.x + title.width).toBeLessThanOrEqual(actions.x);
  await page.screenshot({ path: testInfo.outputPath("mobile-table.png"), fullPage: true });
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "How to play Dice Dash", exact: true })).toBeVisible();
  await expect(page.getByText("Be the first player to reach 20 points.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-rules.png"), fullPage: true });
});

test("an invalid invite provides a recovery route", async ({ page }, testInfo) => {
  await page.goto("/join/ABCD2345");
  await page.getByLabel("Display name", { exact: true }).fill("Guest");
  await page.getByRole("button", { name: "Join table", exact: true }).click();
  await expect(page.getByRole("link", { name: /home|browse|find/i }).last()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("What should we call you?");
  await page.screenshot({ path: testInfo.outputPath("invalid-invite-recovery.png"), fullPage: true });
});

test("rules support keyboard reading and copied invites use the current origin with honest feedback", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const invitePath = await host(page, "dice-dash");
  const rulesButton = page.getByRole("button", { name: "How to play", exact: true });
  await rulesButton.click();
  const dialog = page.getByRole("dialog", { name: "How to play Dice Dash", exact: true });
  await expect(dialog.getByText("Winning", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close rules", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Game rules", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close rules", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("desktop-rules.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(rulesButton).toBeFocused();
  await page.getByRole("button", { name: "Copy invite link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invite link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://127.0.0.1:8797${invitePath}`);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException("Permission denied", "NotAllowedError"); }; });
  await page.getByRole("button", { name: "Copy invite link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Couldn't copy. Share code" })).toBeVisible();
});

test("a real transport interruption restores play and updates host controls on both clients", async ({ page, browser }, testInfo) => {
  const serverSockets: WebSocketRoute[] = [];
  const socketUrls: string[] = [];
  await page.routeWebSocket((url) => url.pathname.endsWith("/ws"), (route) => {
    socketUrls.push(route.url());
    serverSockets.push(route.connectToServer());
  });
  const invite = await host(page, "dice-dash");
  const other = await guest(browser, invite);
  try {
    await expect(page.getByRole("button", { name: "Show 2 players", exact: true })).toBeVisible();
    const progress = page.getByRole("complementary", { name: "Game progress", exact: true });
    await page.getByRole("button", { name: "Roll Die", exact: true }).click();
    await expect(progress.getByRole("status")).toContainText("Sam");
    const scores = await progress.locator("li strong").allTextContents();
    await serverSockets[0]!.close({ code: 1000, reason: "Browser acceptance test transport restart" });
    await expect.poll(() => serverSockets.length).toBe(2);
    await expect(page.locator(".connection-overlay")).toHaveCount(0);
    await expect(other.page.getByRole("complementary", { name: "Players", exact: true }).locator("em")).toHaveText(["Connected", "Connected"]);
    await expect(progress.locator("li strong")).toHaveText(scores);
    for (const playerPage of [page, other.page]) await playerPage.getByLabel("Open table menu", { exact: true }).click();
    await expect(other.page.getByRole("menuitem", { name: "End table", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "End table", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("transport-restored.png"), fullPage: true });
    await other.page.screenshot({ path: testInfo.outputPath("migrated-host-controls.png"), fullPage: true });
    for (const playerPage of [page, other.page]) await playerPage.getByLabel("Open table menu", { exact: true }).click();
    await other.page.getByRole("button", { name: "Roll Die", exact: true }).click();
    await expect(progress.getByRole("status")).toContainText("Alex");
    await expect(other.page.getByRole("complementary", { name: "Game progress", exact: true }).locator("li strong")).toHaveText(await progress.locator("li strong").allTextContents());
    expect(socketUrls.every((url) => new URL(url).searchParams.get("presence") === "1")).toBe(true);
  } finally { await other.context.close(); }
});

test("a failed table view offers recovery and reload preserves the existing private hand", async ({ page }, testInfo) => {
  const adapterImport = /\/assets\/(?:lite|webgl)SceneAdapter-[^/]+\.js$/;
  await page.route(adapterImport, (route) => route.abort("failed"));
  await host(page, "first-deal", false);
  await expect(page.getByRole("alert").filter({ hasText: "The table view could not load." })).toBeVisible();
  await page.getByRole("button", { name: "Draw card", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1);
  const cardName = await page.getByRole("button", { name: /^Inspect / }).getAttribute("aria-label");
  const roomUrl = page.url();
  await page.screenshot({ path: testInfo.outputPath("table-view-failure.png"), fullPage: true });
  await page.unroute(adapterImport);
  await page.getByRole("button", { name: "Reload table view", exact: true }).click();
  await renderedTable(page);
  expect(page.url()).toBe(roomUrl);
  await expect(page.getByRole("button", { name: cardName!, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("table-view-recovered.png"), fullPage: true });
});
