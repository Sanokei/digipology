import { test, expect, type Page, type BrowserContext, type TestInfo } from "./fixtures";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const packPath = fileURLToPath(new URL("../apps/web/public/audio/table-effects/v1/bundle.json", import.meta.url));
const draftPath = fileURLToPath(new URL("./fixtures/raster-draft.editor.json", import.meta.url));
const assetPath = "runtime/presentation/table-sounds.json";
type Heard = { duration: number; sampleRate: number; samples: number; hash: number; rms: number; peak: number; signature: number[] };
type AudioWindow = Window & { heard: Heard[]; audioOutputs: GainNode[]; denyDecode: boolean };

async function monitor(context: BrowserContext) {
  await context.addInitScript(() => {
    const target = window as unknown as AudioWindow; target.heard = []; target.audioOutputs = []; target.denyDecode = false;
    const contexts = new WeakSet<AudioContext>(), gain = AudioContext.prototype.createGain, decode = AudioContext.prototype.decodeAudioData, start = AudioBufferSourceNode.prototype.start;
    AudioContext.prototype.createGain = function() { const node = gain.call(this); if (!contexts.has(this)) { contexts.add(this); target.audioOutputs.push(node); } return node; };
    AudioContext.prototype.decodeAudioData = function(...args: Parameters<AudioContext["decodeAudioData"]>) { if (target.denyDecode) return Promise.reject(new DOMException("Controlled decoder failure", "EncodingError")); return decode.apply(this, args); };
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<AudioBufferSourceNode["start"]>) {
      const b = this.buffer;
      if (b) { let hash = 2166136261, power = 0, peak = 0;
        for (const sample of b.getChannelData(0)) { const n = Math.round(sample * 32768); hash = Math.imul(hash ^ (n & 255), 16777619); hash = Math.imul(hash ^ (n >> 8 & 255), 16777619); power += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
        const signal = b.getChannelData(0), signature = Array.from({ length: 512 }, (_, index) => signal[Math.floor(index * b.length / 512)]!);
        target.heard.push({ duration: b.duration, sampleRate: b.sampleRate, samples: b.length, hash: hash >>> 0, rms: Math.sqrt(power / b.length), peak, signature });
      }
      return start.apply(this, args);
    };
  });
}
const heard = (page: Page) => page.evaluate(() => (window as unknown as AudioWindow).heard);
const clear = (page: Page) => page.evaluate(() => { (window as unknown as AudioWindow).heard.length = 0; });
function pcmBytes(dataUrl: string) {
  const bytes = Buffer.from(dataUrl.split(",")[1]!, "base64"); let pcm: Buffer | undefined;
  for (let at = 12; at < bytes.length;) { const n = bytes.readUInt32LE(at + 4); if (bytes.toString("ascii", at, at + 4) === "data") { pcm = bytes.subarray(at + 8, at + 8 + n); break; } at += 8 + n + n % 2; }
  if (!pcm) throw new Error("Missing expected master PCM");
  return pcm;
}
function pcmHash(dataUrl: string) { let hash = 2166136261; for (const byte of pcmBytes(dataUrl)) hash = Math.imul(hash ^ byte, 16777619); return hash >>> 0; }
function clipCorrelation(record: Heard, clip: { dataUrl: string }): number {
  const pcm = pcmBytes(clip.dataUrl), samples = pcm.length / 2;
  if (record.sampleRate !== 48000 || record.samples !== samples || Math.abs(record.duration - samples / 48000) > .0001 || record.signature?.length !== 512 || record.rms <= .001 || record.peak > .9) return 0;
  let dot = 0, a = 0, b = 0;
  for (let index = 0; index < 512; index++) { const expected = pcm.readInt16LE(Math.floor(index * samples / 512) * 2) / 32768, actual = record.signature[index]!; dot += expected * actual; a += expected * expected; b += actual * actual; }
  return dot / Math.sqrt(a * b);
}
async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByRole("img", { name: "Live synchronized 3D tabletop", exact: true })).toHaveAttribute("data-render-state", "ready", { timeout: 30_000 });
  await expect(page.locator(".table-render-status")).toHaveCount(0);
}
async function settings(page: Page) { if (await page.locator(".table-audio").getAttribute("open") === null) await page.getByLabel("Sound settings", { exact: true }).click(); return page.locator(".table-audio__settings"); }
async function sourceReady(page: Page) { const panel = await settings(page); await expect(panel).toHaveAttribute("data-audio-state", "ready"); return panel; }
async function menu(page: Page, action: string) { await page.locator(".editor-menu-dropdown > summary").filter({ hasText: /^File$/ }).click(); await page.locator(".editor-menu-dropdown[open]").getByRole("button", { name: action }).click(); }
async function signIn(page: Page) {
  await page.goto("/login"); await page.getByLabel("Email address", { exact: true }).fill(`sounds-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a link", exact: true }).click(); await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  const { link } = await (await page.request.get("/api/dev/last-magic-link")).json() as { link: string }; await page.goto(link);
}
async function download(page: Page, info: TestInfo, name: string, trigger: () => Promise<void>) {
  const pending = page.waitForEvent("download"); await trigger(); const path = info.outputPath(name); await (await pending).saveAs(path); return { path, text: await readFile(path, "utf8") };
}
async function importDraft(page: Page, path: string, id: string) {
  await page.goto(`/edit/${id}`); const choosing = page.waitForEvent("filechooser"); await menu(page, "Import draft or bundle…"); await (await choosing).setFiles(path);
  await expect(page.locator(".editor-details-bar").getByLabel("Title", { exact: true })).toHaveValue("Dice Dash");
}

test("a real mastered creator bundle survives editor import, backup, private dice events, publication, credit download and guest reload", async ({ page, context, browser }, info) => {
  test.setTimeout(180_000); await monitor(context);
  const text = await readFile(packPath, "utf8"), pack = JSON.parse(text), original = JSON.parse(await readFile(draftPath, "utf8"));
  const card = pack.clips.find((c: { cue: string }) => c.cue === "card"), dice = pack.clips.find((c: { cue: string }) => c.cue === "dice");
  await signIn(page); await importDraft(page, draftPath, `sound-editor-${Date.now()}`);
  await menu(page, "Add sound bundle…"); const dialog = page.getByRole("dialog", { name: "Add a sound bundle", exact: true });
  await expect(dialog.getByRole("button", { name: "Close sound import", exact: true })).toBeFocused();
  await dialog.getByLabel("Sound bundle JSON", { exact: true }).setInputFiles(packPath);
  await dialog.getByLabel("Sound settings", { exact: true }).click();
  await expect(dialog.locator(".table-audio__settings")).toHaveAttribute("data-audio-state", "ready");
  await clear(page); await dialog.getByRole("button", { name: "Test sound", exact: true }).click();
  await expect.poll(async () => (await heard(page)).some((r) => clipCorrelation(r, card) > .999)).toBe(true);
  const bad = structuredClone(pack); bad.clips[0].sha256 = `sha256:${"0".repeat(64)}`;
  await dialog.getByLabel("Sound bundle JSON", { exact: true }).setInputFiles({ name: "damaged.sounds.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(dialog.getByRole("alert")).toContainText("SHA-256"); await expect(dialog.getByRole("button", { name: "Use in this game", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("sound-import-damaged-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("sound-import-damaged-390.png"), fullPage: false });
  await dialog.getByLabel("Sound bundle JSON", { exact: true }).setInputFiles(packPath);
  await expect(dialog.getByRole("alert")).toHaveCount(0); await expect(dialog.getByRole("button", { name: "Use in this game", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Use in this game", exact: true }).focus(); await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close sound import", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Use in this game", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });
  const backup = await download(page, info, "with-sounds.editor.json", () => menu(page, "Download editable draft"));
  const saved = JSON.parse(backup.text); expect(saved.artwork).toEqual(original.artwork); expect(saved.generationReview).toEqual(original.generationReview);
  expect(saved.bundle.initialSnapshot).toEqual(original.bundle.initialSnapshot); expect(saved.bundle.integrity.manifestHash).not.toBe(original.bundle.integrity.manifestHash);
  expect(saved.bundle.files.find((f: { path: string }) => f.path === assetPath).content).toBe(text);
  expect(saved.bundle.files.filter((f: { path: string }) => f.path !== assetPath)).toEqual(original.bundle.files);
  const release = await download(page, info, "with-sounds.release.json", () => menu(page, "Export release bundle"));
  expect(JSON.parse(release.text).artwork).toBeUndefined(); expect(JSON.parse(release.text).files.find((f: { path: string }) => f.path === assetPath).content).toBe(text);
  await menu(page, "Publish…"); await ready(page); const panel = await sourceReady(page);
  await expect(panel).toHaveAttribute("data-sound-pack", `${pack.id}@1`); await expect(page.getByRole("button", { name: "Review playtest", exact: true })).toHaveText("Review your changes");
  await page.getByLabel("Sound settings", { exact: true }).click(); await clear(page);
  const score = page.getByLabel("Game progress", { exact: true }).locator("li strong").first();
  const beforeScore = await score.innerText(); await page.getByRole("button", { name: "Roll Die", exact: true }).click(); await expect(score).not.toHaveText(beforeScore);
  await writeFile(info.outputPath("private-first-cue.json"), JSON.stringify({ heard: await heard(page), expectedDiceHash: pcmHash(dice.dataUrl), browser: await page.evaluate(() => ({ visibility: document.visibilityState, outputs: (window as unknown as AudioWindow).audioOutputs.map((g) => ({ state: g.context.state, sampleRate: g.context.sampleRate, gain: g.gain.value })) })) }, null, 2));
  await expect.poll(async () => (await heard(page)).some((r) => clipCorrelation(r, dice) > .999)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 }); await sourceReady(page);
  await page.screenshot({ path: info.outputPath("private-source-sounds-390.png"), fullPage: false });
  await page.getByLabel("Sound settings", { exact: true }).click(); await page.getByRole("button", { name: "Publish & invite", exact: true }).click(); await expect(page).toHaveURL(/\/table\//); await ready(page);
  const publishedPanel = await sourceReady(page);
  await publishedPanel.getByText("Sources and credits", { exact: true }).click(); await expect(publishedPanel).toContainText("Kenney"); await expect(publishedPanel.getByRole("link", { name: "CC0-1.0", exact: true })).toHaveCount(3);
  const downloaded = await download(page, info, "published.sounds.json", () => publishedPanel.getByRole("button", { name: "Download sound bundle", exact: true }).click()); expect(downloaded.text).toBe(text);
  await page.screenshot({ path: info.outputPath("published-sound-credits-390.png"), fullPage: false });
  const volume = publishedPanel.getByLabel("Sound volume", { exact: true }); await volume.focus(); await volume.press("Home"); for (let i = 0; i < 10; i++) await volume.press("ArrowRight"); await expect(volume).toHaveValue("10");
  await expect.poll(() => page.evaluate(() => (window as unknown as AudioWindow).audioOutputs.filter((g) => g.context.state !== "closed").some((g) => Math.abs(g.gain.value - .1) < .001))).toBe(true);
  await publishedPanel.getByRole("button", { name: "Mute sound", exact: true }).click(); await clear(page);
  await page.getByLabel("Sound settings", { exact: true }).click(); const scoreBefore = await score.innerText(); await page.getByRole("button", { name: "Roll Die", exact: true }).click(); await expect(score).not.toHaveText(scoreBefore); expect(await heard(page)).toEqual([]);
  await page.reload(); await ready(page); expect(await heard(page)).toEqual([]);
  const restoredPanel = await sourceReady(page); await expect(restoredPanel.getByLabel("Sound volume", { exact: true })).toHaveValue("10"); await expect(restoredPanel.getByRole("button", { name: "Unmute sound", exact: true })).toHaveAttribute("aria-pressed", "true");
  const library = await (await page.request.get("/api/games/mine")).json(); expect(library.games).toHaveLength(1); const game = library.games[0];
  const actual = await (await page.request.get(`/api/releases/${game.latestReleaseId}/bundle`)).json();
  expect(actual.files.find((f: { path: string }) => f.path === assetPath).content).toBe(text);
  expect(actual.files.filter((f: { path: string }) => f.path !== assetPath)).toEqual(original.bundle.files);
  expect(actual.initialSnapshot.state).toEqual({ ...original.bundle.initialSnapshot.state, releaseId: actual.releaseId });
  expect(await (await page.request.get(`/api/games/${game.slug}/cover-info?v=1`)).json()).toEqual({ coverVersion: 1, artwork: original.artwork.info });
  const cover = await (await page.request.get(`/api/games/${game.slug}/cover?v=1`)).body(); expect(`sha256:${createHash("sha256").update(cover).digest("hex")}`).toBe(original.artwork.info.sha256);
  const invite = await page.getByRole("button", { name: "Copy invite link", exact: true }).getAttribute("title");
  const guestContext = await browser.newContext({ baseURL: "http://127.0.0.1:8797", viewport: { width: 390, height: 844 } }); await monitor(guestContext);
  const guest = await guestContext.newPage(); await guest.goto(invite!); await guest.getByLabel("Display name", { exact: true }).fill("Sound guest"); await guest.getByRole("button", { name: "Join table", exact: true }).click(); await ready(guest); expect(await heard(guest)).toEqual([]);
  const guestPanel = await sourceReady(guest); await clear(guest); await guestPanel.getByRole("button", { name: "Test sound", exact: true }).click();
  await expect.poll(async () => (await heard(guest)).some((r) => clipCorrelation(r, card) > .999)).toBe(true);
  await guest.screenshot({ path: info.outputPath("guest-source-sounds-390.png"), fullPage: false });
  const guestHeard = await heard(guest);
  await writeFile(info.outputPath("sound-playback.json"), JSON.stringify({ owner: await heard(page), guest: guestHeard, guestCardCorrelations: guestHeard.map((r) => clipCorrelation(r, card)), expectedCardPcmHash: pcmHash(card.dataUrl), expectedDicePcmHash: pcmHash(dice.dataUrl), decodedFingerprintScope: "512-point waveform correlation >0.999; native decoded floats need not round to bit-identical PCM; original/master file SHA-256 remains exact", releaseAssetExact: true, coverVersion: game.coverVersion }, null, 2));
  await guestContext.close(); await page.setViewportSize({ width: 1440, height: 960 }); await importDraft(page, backup.path, `sound-reopened-${Date.now()}`);
  const reopened = await download(page, info, "reopened-sounds.editor.json", () => menu(page, "Download editable draft")); expect(JSON.parse(reopened.text).bundle).toEqual(saved.bundle); expect(JSON.parse(reopened.text).artwork).toEqual(saved.artwork);
});

test("normal card draws in another seat stay silent while public and own card events remain audible", async ({ page, context, browser }, info) => {
  test.setTimeout(120_000); await monitor(context); await page.goto("/games/first-deal"); await page.getByRole("button", { name: "Play or host", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Card owner"); await page.getByRole("button", { name: "Create table", exact: true }).click(); const invite = await page.getByLabel("Invite URL", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Enter table", exact: true }).click(); await ready(page); await sourceReady(page); await page.getByLabel("Sound settings", { exact: true }).click();
  const guestContext = await browser.newContext({ baseURL: "http://127.0.0.1:8797" }); await monitor(guestContext); const guest = await guestContext.newPage();
  await guest.goto(invite); await guest.getByLabel("Display name", { exact: true }).fill("Listening guest"); await guest.getByRole("button", { name: "Join table", exact: true }).click(); await ready(guest); await sourceReady(guest); await guest.getByLabel("Sound settings", { exact: true }).click();
  await clear(page); await clear(guest); await guest.bringToFront();
  await guest.getByLabel("Open table menu", { exact: true }).click(); await guest.getByRole("menuitem", { name: "Diagnostics", exact: true }).click();
  await guest.getByLabel("Open table menu", { exact: true }).click();
  const sequence = guest.getByLabel("Diagnostics", { exact: true }).locator("dd").first();
  const beforePublic = Number(await sequence.innerText());
  await page.getByRole("button", { name: "Shuffle deck", exact: true }).click(); await expect.poll(async () => Number(await sequence.innerText())).toBeGreaterThan(beforePublic);
  await expect.poll(async () => (await heard(guest)).length).toBeGreaterThan(0);
  const publicControlSources = await heard(guest); await clear(guest); const beforePrivate = Number(await sequence.innerText());
  await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(1);
  await expect(guest.getByText("Your hand is empty", { exact: true })).toBeVisible(); expect(await guest.evaluate(() => document.visibilityState)).toBe("visible");
  // Wait for the guest's confirmed draw in diagnostics, not for arbitrary elapsed silence.
  await expect.poll(async () => Number(await sequence.innerText())).toBeGreaterThan(beforePrivate);
  expect(await heard(guest)).toEqual([]);
  await guest.screenshot({ path: info.outputPath("other-seat-draw-silent.png"), fullPage: false });
  await writeFile(info.outputPath("private-sound-scope.json"), JSON.stringify({ guestVisibility: await guest.evaluate(() => document.visibilityState), publicControlSources, guestSourcesAfterOtherDraw: await heard(guest), ownerHandCount: await page.getByRole("button", { name: /^Inspect / }).count() }, null, 2));
  await page.bringToFront(); await clear(page); await page.getByRole("button", { name: "Draw card", exact: true }).click(); await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(2);
  await expect.poll(async () => (await heard(page)).length).toBeGreaterThan(0);
  await page.reload(); await ready(page); expect(await heard(page)).toEqual([]); await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(2);
  await guestContext.close();
});

test("source fetch and decoder failures show retry, preserve playable fallback and recover to exact decoded assets", async ({ page, context }, info) => {
  await monitor(context); await page.route("**/audio/table-effects/v1/bundle.json", (route) => route.fulfill({ status: 503, body: "Controlled source outage" }));
  await page.goto("/games/dice-dash"); await page.getByRole("button", { name: "Play or host", exact: true }).click(); await page.getByLabel("Display name", { exact: true }).fill("Audio recovery"); await page.getByRole("button", { name: "Create table", exact: true }).click(); await page.getByRole("button", { name: "Enter table", exact: true }).click(); await ready(page);
  expect(await heard(page)).toEqual([]); const panel = await settings(page); await expect(panel).toHaveAttribute("data-audio-state", "failed"); await expect(panel.getByRole("alert")).toContainText("503");
  await panel.getByRole("button", { name: "Test sound", exact: true }).click(); await expect.poll(async () => (await heard(page)).length).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("source-outage-desktop.png"), fullPage: false });
  await page.unroute("**/audio/table-effects/v1/bundle.json"); await page.evaluate(() => { (window as unknown as AudioWindow).denyDecode = true; });
  await panel.getByRole("button", { name: "Retry source sounds", exact: true }).click(); await expect(panel.getByRole("alert")).toContainText("Controlled decoder failure");
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath("decode-failure-390.png"), fullPage: false });
  await page.evaluate(() => { (window as unknown as AudioWindow).denyDecode = false; }); await panel.getByRole("button", { name: "Retry source sounds", exact: true }).click(); await expect(panel).toHaveAttribute("data-audio-state", "ready"); await clear(page);
  await panel.getByRole("button", { name: "Test sound", exact: true }).click(); const pack = JSON.parse(await readFile(packPath, "utf8"));
  await expect.poll(async () => (await heard(page)).some((r) => clipCorrelation(r, pack.clips[0]) > .999)).toBe(true);
  await page.screenshot({ path: info.outputPath("source-recovered-390.png"), fullPage: false });
  // Controlled visibility transition isolates this lifecycle from headless window scheduling.
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await clear(page); await page.evaluate(() => { Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Roll Die")!.click(); });
  await expect.poll(() => page.getByLabel("Game progress", { exact: true }).locator("li strong").first().innerText()).not.toBe("0"); expect(await heard(page)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as AudioWindow).audioOutputs.filter((g) => g.context.state !== "closed").every((g) => g.context.state === "suspended"))).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(await heard(page)).toEqual([]); await panel.getByRole("button", { name: "Test sound", exact: true }).click(); await expect.poll(async () => (await heard(page)).length).toBe(1);
  await writeFile(info.outputPath("recovery-playback.json"), JSON.stringify({ recovered: await heard(page), controlledVisibility: true, noMissedCueReplay: true }, null, 2));
});
