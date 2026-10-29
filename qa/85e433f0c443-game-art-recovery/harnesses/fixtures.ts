import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

/** Independent visitors against one local Worker, without bypassing auth limits.
 * Cloudflare supplies this header in production; Miniflare accepts it locally.
 * Each test retains a stable IP, so repeated requests within a case still count.
 */
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    const hash = createHash("sha256").update(`${testInfo.testId}:${testInfo.project.name}:${testInfo.repeatEachIndex}:${testInfo.retry}`).digest("hex");
    const ip = `2001:db8:${hash.slice(0, 4)}:${hash.slice(4, 8)}:${hash.slice(8, 12)}:${hash.slice(12, 16)}:${hash.slice(16, 20)}:${hash.slice(20, 24)}`;
    await use({ ...extraHTTPHeaders, "CF-Connecting-IP": ip });
  },
});
export { expect } from "@playwright/test";
export type { Page, Browser, BrowserContext, Locator, WebSocketRoute, TestInfo } from "@playwright/test";
