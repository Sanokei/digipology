export interface RateLimitStore {
  increment(key: string, windowStart: number, expiresAt: number, now: number): Promise<number>;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("limit must be positive");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new RangeError("windowMs must be positive");
  }

  async consume(key: string, now: number): Promise<RateLimitResult> {
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const count = await this.store.increment(key, windowStart, windowStart + this.windowMs, now);
    return {
      allowed: count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart + this.windowMs - now) / 1000)),
    };
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly #entries = new Map<string, { windowStart: number; count: number }>();

  increment(key: string, windowStart: number, _expiresAt: number, _now: number): Promise<number> {
    const current = this.#entries.get(key);
    const count = current?.windowStart === windowStart ? current.count + 1 : 1;
    this.#entries.set(key, { windowStart, count });
    return Promise.resolve(count);
  }
}
