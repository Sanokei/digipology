import type { UserDto } from "digipology-protocol/http";
import { rollingSessionExpiry } from "./cookies";
import {
  generateOpaqueToken,
  hashSelector,
  hmacSha256Hex,
  sha256Hex,
  timingSafeHashEqual,
} from "./crypto";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export interface MagicLinkRecord {
  id: string;
  email: string;
  tokenSelector: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface MagicLinkRepository {
  insertMagicLink(record: MagicLinkRecord): Promise<void>;
  findMagicLinks(tokenSelector: string): Promise<MagicLinkRecord[]>;
  consumeMagicLink(id: string, now: number): Promise<boolean>;
}

export interface SessionRecord {
  id: string;
  user: UserDto;
  tokenSelector: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface SessionRepository {
  insertSession(record: SessionRecord): Promise<void>;
  findSessions(tokenSelector: string): Promise<SessionRecord[]>;
  refreshSession(id: string, now: number, expiresAt: number): Promise<boolean>;
  revokeSession(id: string, now: number): Promise<boolean>;
}

export interface CreatedMagicLink {
  id: string;
  token: string;
  expiresAt: number;
}

export interface CreatedSession {
  token: string;
  expiresAt: number;
}

export interface AuthenticatedSession {
  user: UserDto;
  token: string;
  expiresAt: number;
}

const DUMMY_HASH = "0".repeat(64);

export async function createMagicLink(
  repository: MagicLinkRepository,
  email: string,
  now: number,
  random: Crypto = crypto,
): Promise<CreatedMagicLink> {
  const token = generateOpaqueToken(random);
  const tokenHash = await sha256Hex(token, random.subtle);
  const expiresAt = now + MAGIC_LINK_TTL_MS;
  const id = `magic_${generateOpaqueToken(random).slice(0, 32)}`;
  await repository.insertMagicLink({
    id,
    email,
    tokenSelector: hashSelector(tokenHash),
    tokenHash,
    createdAt: now,
    expiresAt,
    consumedAt: null,
  });
  return { id, token, expiresAt };
}

export async function consumeMagicLink(
  repository: MagicLinkRepository,
  token: string,
  now: number,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<string | null> {
  const tokenHash = await sha256Hex(token, subtle);
  const candidates = await repository.findMagicLinks(hashSelector(tokenHash));
  let matched: MagicLinkRecord | null = null;
  if (candidates.length === 0) await timingSafeHashEqual(tokenHash, DUMMY_HASH, subtle);
  for (const candidate of candidates) {
    const equal = await timingSafeHashEqual(tokenHash, candidate.tokenHash, subtle);
    if (equal && matched === null) matched = candidate;
  }
  if (matched === null || matched.consumedAt !== null || now >= matched.expiresAt) return null;
  return await repository.consumeMagicLink(matched.id, now) ? matched.email : null;
}

export async function createSession(
  repository: SessionRepository,
  user: UserDto,
  secret: string,
  now: number,
  random: Crypto = crypto,
): Promise<CreatedSession> {
  const token = generateOpaqueToken(random);
  const tokenHash = await hmacSha256Hex(token, secret, random.subtle);
  const expiresAt = rollingSessionExpiry(now);
  await repository.insertSession({
    id: `session_${generateOpaqueToken(random).slice(0, 32)}`,
    user,
    tokenSelector: hashSelector(tokenHash),
    tokenHash,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
    revokedAt: null,
  });
  return { token, expiresAt };
}

export async function authenticateSession(
  repository: SessionRepository,
  token: string | null,
  secret: string,
  now: number,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<AuthenticatedSession | null> {
  if (token === null) return null;
  const tokenHash = await hmacSha256Hex(token, secret, subtle);
  const candidates = await repository.findSessions(hashSelector(tokenHash));
  let matched: SessionRecord | null = null;
  if (candidates.length === 0) await timingSafeHashEqual(tokenHash, DUMMY_HASH, subtle);
  for (const candidate of candidates) {
    const equal = await timingSafeHashEqual(tokenHash, candidate.tokenHash, subtle);
    if (equal && matched === null) matched = candidate;
  }
  if (matched === null || matched.revokedAt !== null || now >= matched.expiresAt) return null;
  const expiresAt = rollingSessionExpiry(now);
  if (!await repository.refreshSession(matched.id, now, expiresAt)) return null;
  return { user: matched.user, token, expiresAt };
}

export async function revokeSessionToken(
  repository: SessionRepository,
  token: string | null,
  secret: string,
  now: number,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<void> {
  if (token === null) return;
  const tokenHash = await hmacSha256Hex(token, secret, subtle);
  const candidates = await repository.findSessions(hashSelector(tokenHash));
  if (candidates.length === 0) await timingSafeHashEqual(tokenHash, DUMMY_HASH, subtle);
  for (const candidate of candidates) {
    if (await timingSafeHashEqual(tokenHash, candidate.tokenHash, subtle)) {
      await repository.revokeSession(candidate.id, now);
      return;
    }
  }
}
