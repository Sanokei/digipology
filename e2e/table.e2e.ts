import { test, expect, type Browser, type Page } from "@playwright/test";

async function host(page: Page, slug: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /host a room/i }).first().click();
  await page.getByLabel("Game", { exact: true }).selectOption(slug);
  await page.getByLabel("Display name", { exact: true }).fill("Alex");
  await page.getByRole("button", { name: "Create table", exact: true }).click();
  const invite = await page.getByLabel("Invite URL", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Enter table", exact: true }).click();
  await page.getByRole("img", { name: "Live synchronized 3D tabletop" }).waitFor();
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
    await expect(panels[0]!.getByRole("listitem")).toHaveCount(2);
    let turns = 0;
    for (; turns < 40; turns += 1) {
      if ((await panels[0]!.getByRole("status").innerText()).includes("wins Dice Dash!")) break;
      const current = await page.getByRole("button", { name: "Roll Die", exact: true }).isEnabled() ? page : other.page;
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
    await page.getByLabel("Sound settings", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Unmute sound", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
    expect(wasmHosts.length).toBeGreaterThan(0);
    expect(wasmHosts.every((host) => host === "127.0.0.1:8797")).toBe(true);
  } finally { await other.context.close(); }
});

test("card actions draw into a real hand and the invitee has a separate hand", async ({ page, browser }, testInfo) => {
  const invite = await host(page, "first-deal");
  const other = await guest(browser, invite);
  try {
    await expect(page.getByRole("button", { name: "Draw card", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Shuffle deck", exact: true }).click();
    await page.getByRole("button", { name: "Draw card", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1);
    await expect(other.page.getByText("Your hand is empty", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Inspect / }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("card-inspection.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  } finally { await other.context.close(); }
});

test("mobile table keeps play controls reachable without horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await host(page, "dice-dash");
  await expect(page.getByRole("button", { name: "Roll Die", exact: true })).toBeEnabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-table.png"), fullPage: true });
});

test("an invalid invite provides a recovery route", async ({ page }) => {
  await page.goto("/join/ABCD2345");
  await page.getByLabel("Display name", { exact: true }).fill("Guest");
  await page.getByRole("button", { name: "Join table", exact: true }).click();
  await expect(page.getByRole("link", { name: /home|browse|find/i }).last()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("What should we call you?");
});
