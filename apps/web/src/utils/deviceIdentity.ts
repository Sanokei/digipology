export const DEVICE_ID_KEY = "dgp.device.id";
export const DEVICE_COOKIE_NAME = "dgp_device_id";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5;

export interface DeviceIdentityEnvironment {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  readCookie(): string | null;
  writeCookie(id: string, maxAgeSeconds: number): void;
  randomUUID(): string;
}

export function resolveDeviceId(environment: DeviceIdentityEnvironment): string {
  let stored: string | null = null;
  let cookie: string | null = null;
  try { stored = environment.storage?.getItem(DEVICE_ID_KEY) ?? null; } catch { stored = null; }
  try { cookie = environment.readCookie(); } catch { cookie = null; }
  const id = stored || cookie || environment.randomUUID();
  try { environment.storage?.setItem(DEVICE_ID_KEY, id); } catch { /* Storage can be disabled. */ }
  try { environment.writeCookie(id, DEVICE_COOKIE_MAX_AGE); } catch { /* Cookies can be disabled. */ }
  return id;
}

function readDeviceCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${DEVICE_COOKIE_NAME}=`;
  const part = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return part === undefined ? null : decodeURIComponent(part.slice(prefix.length));
}

function writeDeviceCookie(id: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  document.cookie = `${DEVICE_COOKIE_NAME}=${encodeURIComponent(id)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

export function deviceId(): string {
  if (typeof window === "undefined" || typeof crypto === "undefined") return "anonymous";
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { storage = null; }
  return resolveDeviceId({
    storage,
    readCookie: readDeviceCookie,
    writeCookie: writeDeviceCookie,
    randomUUID: () => crypto.randomUUID(),
  });
}

export function deviceIdentity(user: { id: string } | null | undefined): string {
  return user?.id ? `user:${user.id}` : `device:${deviceId()}`;
}
