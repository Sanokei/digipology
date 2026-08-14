export const SESSION_COOKIE_NAME = "dgp_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function parseCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function rollingSessionExpiry(now: number): number {
  return now + SESSION_TTL_MS;
}

export function serializeSessionCookie(token: string, expiresAt: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
