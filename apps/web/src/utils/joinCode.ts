export function normalizeJoinCode(code: string): string {
  const trimmed = code.trim();
  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    candidate = decodeURIComponent(segments.at(-1) ?? "");
  } catch {
    // Raw invite codes are expected more often than URLs.
  }
  const compact = candidate.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  return compact.length <= 4 ? compact : `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
}

export function isJoinCode(code: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeJoinCode(code));
}
