import { describe, expect, test } from "bun:test";
import { FixedWindowRateLimiter, MemoryRateLimitStore } from "./rate-limiter";
import { D1Repositories } from "./d1-repositories";

describe("fixed-window rate limiter", () => {
  test("allows through the threshold and rejects the next request", async () => {
    const limiter = new FixedWindowRateLimiter(new MemoryRateLimitStore(), 3, 60_000);
    expect((await limiter.consume("email:a", 10)).allowed).toBe(true);
    expect((await limiter.consume("email:a", 20)).allowed).toBe(true);
    expect((await limiter.consume("email:a", 30)).allowed).toBe(true);
    expect((await limiter.consume("email:a", 40)).allowed).toBe(false);
  });

  test("resets at the next window", async () => {
    const limiter = new FixedWindowRateLimiter(new MemoryRateLimitStore(), 1, 1_000);
    expect((await limiter.consume("ip:a", 999)).allowed).toBe(true);
    expect((await limiter.consume("ip:a", 999)).allowed).toBe(false);
    expect((await limiter.consume("ip:a", 1_000)).allowed).toBe(true);
  });

  test("keeps email and IP keys independent", async () => {
    const limiter = new FixedWindowRateLimiter(new MemoryRateLimitStore(), 1, 60_000);
    expect((await limiter.consume("email:a", 0)).allowed).toBe(true);
    expect((await limiter.consume("email:a", 0)).allowed).toBe(false);
    expect((await limiter.consume("ip:a", 0)).allowed).toBe(true);
    expect((await limiter.consume("email:b", 0)).allowed).toBe(true);
  });

  test("D1 writes prune expired counters opportunistically", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...values: unknown[]) => ({ sql, values }) };
      },
      async batch(input: Array<{ sql: string; values: unknown[] }>) {
        statements.push(...input);
        return [{ results: [] }, { results: [{ count: 1 }] }];
      },
    } as unknown as D1Database;
    const limiter = new FixedWindowRateLimiter(new D1Repositories(db), 2, 1_000);
    expect((await limiter.consume("upload:user:1", 2_500)).allowed).toBe(true);
    expect(statements[0]?.sql).toContain("DELETE FROM rate_limits WHERE expires_at <= ?");
    expect(statements[0]?.values).toEqual([2_500]);
    expect(statements[1]?.values).toEqual(["upload:user:1", 2_000, 3_000, 3_000]);
  });
});
