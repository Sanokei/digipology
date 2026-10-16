import { describe, expect, test } from "bun:test";

import { dayKey, responseRequests } from "./pricing";

describe("request counting", () => {
  test("responseRequests returns 0 for null", () => {
    expect(responseRequests(null)).toBe(0);
  });

  test("responseRequests returns 0 for undefined", () => {
    expect(responseRequests(undefined)).toBe(0);
  });

  test("responseRequests returns 1 for an empty object", () => {
    expect(responseRequests({})).toBe(1);
  });

  test("responseRequests returns 1 when choices are present", () => {
    expect(responseRequests({ choices: [] })).toBe(1);
  });
});

describe("dayKey", () => {
  test("formats a fixed date as YYYY-MM-DD", () => {
    expect(dayKey(new Date("2026-08-14T12:00:00Z"))).toBe("2026-08-14");
  });

  test("returns a 10-char YYYY-MM-DD string", () => {
    const key = dayKey(new Date());
    expect(key).toHaveLength(10);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
