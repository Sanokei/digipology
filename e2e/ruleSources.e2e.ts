import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function menu(page: Page, action: string) {
  await page.locator(".editor-menu-dropdown > summary").filter({ hasText: /^File$/ }).click();
  await page.locator(".editor-menu-dropdown[open]").getByRole("button", { name: action, exact: true }).click();
}
async function download(page: Page, info: TestInfo, name: string, action: string) {
  const pending = page.waitForEvent("download"); await menu(page, action);
  const path = info.outputPath(name); await (await pending).saveAs(path);
  return JSON.parse(await readFile(path, "utf8"));
}
test("source transport with a fixture provider preserves private input through play, editing and editable backup", async ({ page }, info) => {
  const prompt = "Exercise the existing deterministic dice fixture; this is source transport testing.";
  const text = "Kind,Meaning\r\nScope,Transport fixture only\r\nGame,Existing deterministic dice fixture\r\n";
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(`source-transport-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json(); await page.goto(link); await page.goto("/create");
  await page.getByLabel("Game description", { exact: true }).fill(prompt);
  await page.getByLabel("Attach rule or card files", { exact: true }).setInputFiles({ name: "Transport fixture.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
  await expect(page.getByRole("list", { name: "Attached source documents", exact: true })).toContainText("Transport fixture.csv");
  const generated = page.waitForResponse((response) => response.url().endsWith("/api/ai/games") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create & play", exact: true }).click();
  const response = await generated; expect(response.status()).toBe(200);
  const accepted = await response.json();
  await expect(page).toHaveURL(/\/playtest\//);
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  expect((await (await page.request.get("/api/games/mine")).json()).games).toHaveLength(0);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  const request = await download(page, info, "fixture-source.request.json", "Download generation request");
  expect(request).toEqual({ prompt, references: [{ name: "Transport fixture.csv", text }] });
  const backup = await download(page, info, "fixture-source.editor.json", "Download editable draft");
  expect(backup.generationRequest).toEqual(request); expect(backup.bundle).toEqual(accepted.draft);
  const release = await download(page, info, "fixture-source.release.json", "Export release bundle");
  expect(release).toEqual(accepted.draft); expect(JSON.stringify(release)).not.toContain("Transport fixture.csv");
  const title = page.locator(".editor-details-bar").getByLabel("Title", { exact: true });
  await title.fill("Edited fixture game"); await title.press("Tab");
  await page.reload(); await expect(title).toHaveValue("Edited fixture game");
  expect(await download(page, info, "edited-source.request.json", "Download generation request")).toEqual(request);
  const edited = await download(page, info, "edited-source.editor.json", "Download editable draft");
  expect(edited.generationRequest).toEqual(request); expect(edited.bundle.initialSnapshot).toEqual(accepted.draft.initialSnapshot);
  await page.goto(`/edit/source-reopen-${Date.now()}`);
  const choosing = page.waitForEvent("filechooser"); await menu(page, "Import draft or bundle…");
  await (await choosing).setFiles({ name: "source-backup.editor.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(edited)) });
  expect(await download(page, info, "reopened-source.request.json", "Download generation request")).toEqual(request);
  await page.screenshot({ path: info.outputPath("fixture-source-editor-restored.png"), fullPage: false });
});
