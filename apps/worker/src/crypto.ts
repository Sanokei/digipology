export const TOKEN_BYTES = 32;
export const SHA256_HEX_LENGTH = 64;

export function generateOpaqueToken(random: Crypto = crypto): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  random.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(value: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(
  value: string,
  secret: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<string> {
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function hashSelector(hash: string): string {
  return hash.slice(0, 16);
}

export async function timingSafeHashEqual(
  left: string,
  right: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    subtle.digest("SHA-256", new TextEncoder().encode(left)),
    subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const workerSubtle = subtle as SubtleCrypto & {
    timingSafeEqual?: (left: ArrayBuffer, right: ArrayBuffer) => boolean;
  };
  if (workerSubtle.timingSafeEqual !== undefined) {
    return workerSubtle.timingSafeEqual(leftDigest, rightDigest);
  }
  // Bun's Web Crypto lacks the Workers timingSafeEqual extension. Both inputs
  // are fixed-size digests, so tests and non-Workers runtimes use a full scan.
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

export async function encryptDevelopmentToken(
  token: string,
  secret: string,
  random: Crypto = crypto,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await aesKey(secret, random.subtle, ["encrypt"]);
  const iv = new Uint8Array(12);
  random.getRandomValues(iv);
  const ciphertext = await random.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

export async function decryptDevelopmentToken(
  ciphertext: string,
  iv: string,
  secret: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<string> {
  const key = await aesKey(secret, subtle, ["decrypt"]);
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    key,
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function aesKey(
  secret: string,
  subtle: SubtleCrypto,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return subtle.importKey("raw", digest, "AES-GCM", false, usages);
}
