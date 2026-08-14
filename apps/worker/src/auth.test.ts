import { describe, expect, test } from "bun:test";
import {
  MAGIC_LINK_TTL_MS,
  authenticateSession,
  consumeMagicLink,
  createMagicLink,
  createSession,
  revokeSessionToken,
  type MagicLinkRecord,
  type MagicLinkRepository,
  type SessionRecord,
  type SessionRepository,
} from "./auth";

class MemoryAuthRepository implements MagicLinkRepository, SessionRepository {
  readonly magicLinks: MagicLinkRecord[] = [];
  readonly sessions: SessionRecord[] = [];

  insertMagicLink(record: MagicLinkRecord): Promise<void> {
    this.magicLinks.push({ ...record });
    return Promise.resolve();
  }

  findMagicLinks(tokenSelector: string): Promise<MagicLinkRecord[]> {
    return Promise.resolve(this.magicLinks.filter((record) => record.tokenSelector === tokenSelector).map((record) => ({ ...record })));
  }

  consumeMagicLink(id: string, now: number): Promise<boolean> {
    const record = this.magicLinks.find((candidate) => candidate.id === id);
    if (record === undefined || record.consumedAt !== null || now >= record.expiresAt) return Promise.resolve(false);
    record.consumedAt = now;
    return Promise.resolve(true);
  }

  insertSession(record: SessionRecord): Promise<void> {
    this.sessions.push({ ...record, user: { ...record.user } });
    return Promise.resolve();
  }

  findSessions(tokenSelector: string): Promise<SessionRecord[]> {
    return Promise.resolve(this.sessions.filter((record) => record.tokenSelector === tokenSelector).map((record) => ({ ...record, user: { ...record.user } })));
  }

  refreshSession(id: string, now: number, expiresAt: number): Promise<boolean> {
    const record = this.sessions.find((candidate) => candidate.id === id);
    if (record === undefined || record.revokedAt !== null || now >= record.expiresAt) return Promise.resolve(false);
    record.lastUsedAt = now;
    record.expiresAt = expiresAt;
    return Promise.resolve(true);
  }

  revokeSession(id: string, now: number): Promise<boolean> {
    const record = this.sessions.find((candidate) => candidate.id === id);
    if (record === undefined || record.revokedAt !== null) return Promise.resolve(false);
    record.revokedAt = now;
    return Promise.resolve(true);
  }
}

const user = { id: "user_1", name: "Alice", email: "alice@example.com" };
const secret = "test-session-secret-that-is-long-enough";

describe("magic-link token lifecycle", () => {
  test("creates hash-only storage and consumes exactly once", async () => {
    const repository = new MemoryAuthRepository();
    const created = await createMagicLink(repository, user.email, 1_000);
    const stored = repository.magicLinks[0];
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toBe(created.token);
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(await consumeMagicLink(repository, created.token, 2_000)).toBe(user.email);
    expect(await consumeMagicLink(repository, created.token, 2_001)).toBeNull();
  });

  test("rejects expiry at TTL plus one second", async () => {
    const repository = new MemoryAuthRepository();
    const created = await createMagicLink(repository, user.email, 10_000);
    expect(await consumeMagicLink(repository, created.token, 10_000 + MAGIC_LINK_TTL_MS + 1_000)).toBeNull();
  });

  test("rejects a wrong token without consuming the valid link", async () => {
    const repository = new MemoryAuthRepository();
    const created = await createMagicLink(repository, user.email, 0);
    expect(await consumeMagicLink(repository, "f".repeat(64), 1)).toBeNull();
    expect(await consumeMagicLink(repository, created.token, 2)).toBe(user.email);
  });
});

describe("session authentication middleware", () => {
  test("returns anonymous when the cookie is absent", async () => {
    expect(await authenticateSession(new MemoryAuthRepository(), null, secret, 1_000)).toBeNull();
  });

  test("accepts a valid session and rolls its expiry", async () => {
    const repository = new MemoryAuthRepository();
    const created = await createSession(repository, user, secret, 1_000);
    const authenticated = await authenticateSession(repository, created.token, secret, 2_000);
    expect(authenticated?.user).toEqual(user);
    expect(authenticated?.expiresAt).toBeGreaterThan(created.expiresAt);
    expect(repository.sessions[0]?.lastUsedAt).toBe(2_000);
  });

  test("rejects expired and revoked sessions", async () => {
    const expiredRepository = new MemoryAuthRepository();
    const expired = await createSession(expiredRepository, user, secret, 1_000);
    expiredRepository.sessions[0]!.expiresAt = 2_000;
    expect(await authenticateSession(expiredRepository, expired.token, secret, 2_000)).toBeNull();

    const revokedRepository = new MemoryAuthRepository();
    const revoked = await createSession(revokedRepository, user, secret, 1_000);
    await revokeSessionToken(revokedRepository, revoked.token, secret, 1_500);
    expect(await authenticateSession(revokedRepository, revoked.token, secret, 1_600)).toBeNull();
  });

  test("rejects a wrong session token", async () => {
    const repository = new MemoryAuthRepository();
    await createSession(repository, user, secret, 1_000);
    expect(await authenticateSession(repository, "0".repeat(64), secret, 2_000)).toBeNull();
  });
});
