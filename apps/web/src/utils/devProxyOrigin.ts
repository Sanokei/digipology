/** Keep same-origin browser POSTs same-origin after Vite changes the proxy host. */
export function devProxyOrigin(origin: string | undefined, requestHost: string | undefined, target: string): string | undefined {
  if (!origin || !requestHost) return origin;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol) || parsed.host !== requestHost) return origin;
    return new URL(target).origin;
  } catch { return origin; }
}
