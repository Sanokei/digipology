import { describe, expect, test } from "bun:test";
import { FixedWindowRateLimiter, MemoryRateLimitStore } from "./rate-limiter";

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
});
