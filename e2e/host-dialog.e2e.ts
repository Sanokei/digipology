import { expect, test } from "@playwright/test";

test("hosting keeps keyboard focus in the dialog and restores it after Escape", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: /host a room/i }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Host a game", exact: true });
  await expect(dialog.getByLabel("Game", { exact: true })).toBeFocused();

  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Create table", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("hosting hands focus to the invite and keeps the current app origin", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /host a room/i }).first().click();
  await page.getByLabel("Game", { exact: true }).selectOption("first-deal");
  await page.getByLabel("Display name", { exact: true }).fill("Host accessibility test");
  await page.getByRole("button", { name: "Create table", exact: true }).click();
  const invite = page.getByLabel("Invite URL", { exact: true });
  await expect(invite).toBeFocused();
  const url = new URL(await invite.inputValue());
  expect(url.origin).toBe(new URL(page.url()).origin);
  expect(url.pathname).toMatch(/^\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await page.getByRole("button", { name: "Enter table", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeFocused();
});

test("the host dialog does not intercept Escape from the separate sign-in overlay", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /host a room/i }).first().click();
  const host = page.getByRole("dialog", { name: "Host a game", exact: true });
  await host.getByRole("radio", { name: "Public", exact: true }).check();
  await host.getByRole("button", { name: "Sign in to continue", exact: true }).click();
  const signIn = page.getByRole("dialog", { name: "Welcome back", exact: true });
  await expect(signIn.getByRole("button", { name: "Close sign in", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(signIn).not.toBeVisible();
  await expect(host).toBeVisible();
  await host.getByLabel("Game", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(host).not.toBeVisible();
});
