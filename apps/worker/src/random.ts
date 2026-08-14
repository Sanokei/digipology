export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const JOIN_CODE_LENGTH = 8;

// 32 symbols ^ 8 characters = 2^40 possible codes (40 bits of entropy).
export function generateJoinCode(random: Crypto = crypto): string {
  const bytes = new Uint8Array(JOIN_CODE_LENGTH);
  random.getRandomValues(bytes);
  let compact = "";
  for (const byte of bytes) compact += JOIN_CODE_ALPHABET[byte & 31];
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function normalizeJoinCode(value: string): string {
  return value.toUpperCase().replaceAll(/[\t\n\r -]/g, "");
}

export function isValidJoinCode(value: string): boolean {
  const normalized = normalizeJoinCode(value);
  return normalized.length === JOIN_CODE_LENGTH &&
    Array.from(normalized).every((character) => JOIN_CODE_ALPHABET.includes(character));
}

export function generateSessionToken(random: Crypto = crypto): string {
  const bytes = new Uint8Array(32);
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

export function generateGuestName(random: Crypto = crypto): string {
  const bytes = new Uint8Array(4);
  random.getRandomValues(bytes);
  let suffix = "";
  for (const byte of bytes) suffix += JOIN_CODE_ALPHABET[byte & 31];
  return `Guest-${suffix}`;
}
