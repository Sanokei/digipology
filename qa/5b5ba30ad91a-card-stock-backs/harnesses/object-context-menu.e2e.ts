import { test, expect, type Page } from "@playwright/test";

async function hostCards(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /host a room/i }).first().click();
  await page.getByLabel("Game", { exact: true }).selectOption("first-deal");
  await page.getByLabel("Display name", { exact: true }).fill("Menu player");
  await page.getByRole("button", { name: "Create table", exact: true }).click();
  await page.getByRole("button", { name: "Enter table", exact: true }).click();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Show 1 player", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Shuffle deck", exact: true }).click();
  await page.getByRole("button", { name: "Draw card", exact: true }).click();
  await expect(page.getByRole("button", { name: "Inspect 7 of Diamonds", exact: true })).toBeVisible();
}

test.describe("native touch menu activation", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("releasing a hand long press keeps the card private until a fresh menu tap", async ({ page, context }, info) => {
    const errors: string[] = [];
    const actions: string[] = [];
    let watchActions = false;
    page.on("pageerror", (error) => errors.push(error.message));
    // Observe only action types; the transport and game remain unmodified.
    page.on("websocket", (socket) => socket.on("framesent", (frame) => {
      if (!watchActions) return;
      const message = JSON.parse(String(frame.payload)) as { type?: string; action?: { type: string } };
      if (message.type === "action_request" && message.action) actions.push(message.action.type);
    }));
    await hostCards(page);
    await page.getByRole("button", { name: "Draw card", exact: true }).click();
    const queen = page.getByRole("button", { name: "Inspect Queen of Clubs", exact: true });
    await expect(queen).toBeVisible();
    await page.getByRole("button", { name: "Show 1 player", exact: true }).tap();
    await expect(page.getByRole("complementary", { name: "Players", exact: true })).toBeVisible();
    watchActions = true;
    const cardBox = await queen.boundingBox();
    if (!cardBox) throw new Error("Queen has no touch target");
    const point = { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 };
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0, radiusX: 5, radiusY: 5, force: 1 }] });
    await page.waitForTimeout(650);
    const menu = page.getByRole("menu", { name: "Object actions", exact: true });
    const play = menu.getByRole("menuitem", { name: "Play to table", exact: true });
    await expect(play).toBeVisible();
    // This is the dangerous real layout: the newly opened action is underneath
    // the original finger, rather than an artificial click dispatched by a test.
    expect(await play.evaluate((button, finger) => {
      const hit = document.elementFromPoint(finger.x, finger.y);
      return hit === button || (hit !== null && button.contains(hit));
    }, point)).toBe(true);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(250);
    await expect(menu).toBeVisible();
    await expect(queen).toBeVisible();
    await expect(page.locator(".hand-card")).toHaveCount(2);
    expect(actions).toEqual([]);
    await page.screenshot({ path: info.outputPath("long-press-release-keeps-hand.png"), fullPage: false });
    await play.tap();
    await expect(menu).toHaveCount(0);
    await expect(queen).toHaveCount(0);
    await expect(page.locator(".hand-card")).toHaveCount(1);
    await expect.poll(() => actions).toEqual(["entity.grab", "entity.drop"]);
    const seven = page.getByRole("button", { name: "Inspect 7 of Diamonds", exact: true });
    await seven.tap();
    await expect(page.getByRole("dialog", { name: "Inspecting 7 of Diamonds", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close inspect", exact: true }).tap();
    const remainingBox = await seven.boundingBox();
    if (!remainingBox) throw new Error("Remaining card has no touch target");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: remainingBox.x + remainingBox.width / 2, y: remainingBox.y + remainingBox.height / 2, id: 0, radiusX: 5, radiusY: 5, force: 1 }] });
    await page.waitForTimeout(650);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await seven.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Inspecting 7 of Diamonds", exact: true })).toBeVisible();
    expect(actions).toEqual(["entity.grab", "entity.drop"]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("fresh-menu-tap-plays-card.png"), fullPage: false });
  });
});

test("menu actions still accept a fresh mouse click and keyboard activation", async ({ page }) => {
  await hostCards(page);
  const seven = page.getByRole("button", { name: "Inspect 7 of Diamonds", exact: true });
  await seven.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Play to table", exact: true }).click();
  await expect(seven).toHaveCount(0);
  await page.getByRole("button", { name: "Draw card", exact: true }).click();
  const queen = page.getByRole("button", { name: "Inspect Queen of Clubs", exact: true });
  await expect(queen).toBeVisible();
  await queen.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Inspect", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Inspecting Queen of Clubs", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await queen.click({ button: "right" });
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Play to table", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(queen).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Object actions", exact: true })).toHaveCount(0);
});
