import { isJoinCode, normalizeJoinCode } from "./joinCode";

/** Invites belong to the active app host, including local and preview origins. */
export function inviteUrlForCode(code: string, origin: string): string {
  const normalized = normalizeJoinCode(code);
  if (!isJoinCode(normalized)) throw new Error("A valid invite code is required");
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("An HTTP app origin is required");
  return new URL(`/join/${normalized}`, base.origin).href;
}
