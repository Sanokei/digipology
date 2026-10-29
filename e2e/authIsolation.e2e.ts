import { test, expect } from "./fixtures";

test("independent visitors keep the production per-IP magic-link limit within each visit", async ({ page }) => {
  await page.goto("/login");
  const origin = new URL(page.url()).origin;
  for (let index = 0; index < 11; index++) {
    const response = await page.request.post("/api/auth/request-link", {
      headers: { Origin: origin }, data: { email: `ip-cap-${Date.now()}-${index}@example.com` },
    });
    expect(response.status()).toBe(index < 10 ? 204 : 429);
    if (index === 10) expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
  }
});
