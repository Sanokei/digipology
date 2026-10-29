import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(`creator-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const response = await page.request.get("/api/dev/last-magic-link");
  const { link } = await response.json() as { link: string };
  await page.goto(link);
  await page.goto("/create");
  await expect(page.getByText("No uploads yet.", { exact: true })).toBeVisible();
}

async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
}

test("fixture model goes through real repair into an unpublished playable draft, then explicit publication and multiplayer", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  await signIn(page);
  const before = await (await page.request.get("http://127.0.0.1:8795/metrics")).json() as { repairs: number };
  await page.getByLabel("Game description", { exact: true }).fill("Exercise the repair fixture: two people race to 20 points using dice.");
  const generated = page.waitForResponse((response) => response.url().endsWith("/api/ai/games") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  const response = await generated;
  expect(response.status()).toBe(200);
  const accepted = await response.json() as { validationReport: Array<{ check: string; ok: boolean }> };
  expect(accepted.validationReport).toContainEqual({ check: "playability", ok: true });
  await expect(page).toHaveURL(/\/playtest\//);
  await ready(page);
  const after = await (await page.request.get("http://127.0.0.1:8795/metrics")).json() as { repairs: number };
  expect(after.repairs).toBeGreaterThan(before.repairs);
  const library = await page.request.get("/api/games/mine");
  expect((await library.json() as { games: unknown[] }).games).toHaveLength(0);
  const progress = page.getByRole("complementary", { name: "Game progress", exact: true });
  await expect(progress.locator("li")).toHaveCount(2);
  for (let turn = 0; turn < 40; turn++) {
    const status = await progress.getByRole("status").innerText();
    if (status.includes("wins Dice Dash!")) break;
    await page.getByLabel("Play as", { exact: true }).selectOption({ label: status.startsWith("Player 2") ? "Player 2" : "Player 1" });
    await page.getByRole("button", { name: "Roll Die", exact: true }).click();
    await expect(progress.getByRole("status")).not.toHaveText(status);
  }
  await expect(progress.getByRole("status")).toContainText("wins Dice Dash!");
  await page.screenshot({ path: testInfo.outputPath("fixture-private-draft-winner.png"), fullPage: true });
  await page.reload();
  await ready(page);
  await expect(progress.locator("li strong")).toHaveText(["0", "0"]);
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "How to play Dice Dash", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const toolbar = await page.locator(".draft-play-bar").boundingBox();
  const panel = await progress.boundingBox();
  if (!toolbar || !panel) throw new Error("Missing mobile playtest layout");
  expect(panel.y).toBeGreaterThan(toolbar.y + toolbar.height);
  await page.screenshot({ path: testInfo.outputPath("fixture-private-draft-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Publish & invite", exact: true }).click();
  await expect(page).toHaveURL(/\/table\//);
  await ready(page);
  const invite = await page.getByRole("button", { name: "Copy invite link", exact: true }).getAttribute("title");
  const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 1280, height: 900 } });
  try {
    const guest = await otherContext.newPage();
    await guest.goto(new URL(invite!).pathname);
    await guest.getByLabel("Display name", { exact: true }).fill("Guest");
    await guest.getByRole("button", { name: "Join table", exact: true }).click();
    await ready(guest);
    await expect(page.getByRole("button", { name: "Show 2 players", exact: true })).toBeVisible();
    const panels = [page, guest].map((player) => player.getByRole("complementary", { name: "Game progress", exact: true }));
    await expect(panels[0]!.locator("li strong")).toHaveText(["0", "0"]);
    for (let turn = 0; turn < 40; turn++) {
      const status = await panels[0]!.getByRole("status").innerText();
      if (status.includes("wins Dice Dash!")) break;
      const current = await page.getByRole("button", { name: "Roll Die", exact: true }).isEnabled() ? page : guest;
      await current.bringToFront();
      await current.getByRole("button", { name: "Roll Die", exact: true }).click();
      await expect(panels[0]!.getByRole("status")).not.toHaveText(status);
      await expect(panels[1]!.locator("li strong")).toHaveText(await panels[0]!.locator("li strong").allTextContents());
    }
    await expect(panels[0]!.getByRole("status")).toContainText("wins Dice Dash!");
    await page.screenshot({ path: testInfo.outputPath("fixture-published-multiplayer-winner.png"), fullPage: true });
  } finally { await otherContext.close(); }
});

test("provider failure preserves the prompt and never opens an accepted draft", async ({ page }, testInfo) => {
  await signIn(page);
  const prompt = "[provider-down] Preserve this strategy game idea while the provider is unavailable.";
  await page.getByLabel("Game description", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry AI draft", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Game description", { exact: true })).toHaveValue(prompt);
  await expect(page).toHaveURL(/\/create$/);
  await page.screenshot({ path: testInfo.outputPath("fixture-provider-failure.png"), fullPage: true });
});

test("browser storage failure preserves accepted output and retries without another model request", async ({ page }, testInfo) => {
  await signIn(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restoreDraftStorage(): void }).restoreDraftStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key.startsWith("dgp.editor.draft.")) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  let requests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/ai/games" && request.method() === "POST") requests++; });
  await page.getByLabel("Game description", { exact: true }).fill("Exercise the repair fixture with two players.");
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  await expect(page.getByText(/browser storage is unavailable or full/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download draft", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("fixture-draft-storage-recovery.png"), fullPage: true });
  await page.evaluate(() => (window as unknown as { restoreDraftStorage(): void }).restoreDraftStorage());
  await page.getByRole("button", { name: "Retry opening playtest", exact: true }).click();
  await expect(page).toHaveURL(/\/playtest\//);
  await ready(page);
  expect(requests).toBe(1);
});
