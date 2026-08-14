import { describe, expect, test } from "bun:test";
import { clearSessionCookie, parseCookie, rollingSessionExpiry, serializeSessionCookie, SESSION_TTL_MS } from "./cookies";

describe("session cookies", () => {
  test("parses named cookies without confusing prefixes", () => {
    expect(parseCookie("other=1; dgp_session=abc123; dgp_session_extra=no", "dgp_session")).toBe("abc123");
    expect(parseCookie(null, "dgp_session")).toBeNull();
    expect(parseCookie("other=1", "dgp_session")).toBeNull();
  });

  test("serializes the exact security attributes", () => {
    expect(serializeSessionCookie("abc123", Date.UTC(2026, 8, 12))).toBe(
      "dgp_session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Expires=Sat, 12 Sep 2026 00:00:00 GMT",
    );
    expect(clearSessionCookie()).toBe(
      "dgp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });

  test("rolls expiry exactly thirty days from use", () => {
    expect(rollingSessionExpiry(1234)).toBe(1234 + SESSION_TTL_MS);
  });
});
