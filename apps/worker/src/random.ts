export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const JOIN_CODE_LENGTH = 7;

// 32 symbols ^ 7 characters = 2^35 possible codes (35 bits of entropy).
export function generateJoinCode(random: Crypto = crypto): string {
  const bytes = new Uint8Array(JOIN_CODE_LENGTH);
  random.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += JOIN_CODE_ALPHABET[byte & 31];
  return code;
}

export function normalizeJoinCode(value: string): string {
  return value.trim().toUpperCase().replaceAll(/\s+/g, "");
}

export function generateSessionToken(random: Crypto = crypto): string {
  const bytes = new Uint8Array(24);
  random.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generatePlayerId(random: Crypto = crypto): string {
  const bytes = new Uint8Array(12);
  random.getRandomValues(bytes);
  return `player_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
