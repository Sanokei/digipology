export function formatCompactCount(value: number): string {
  const count = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (count < 1_000) return String(count);
  if (count < 999_950) return formatUnit(count / 1_000, "k");
  return formatUnit(count / 1_000_000, "M");
}

function formatUnit(value: number, suffix: string): string {
  const rounded = suffix === "k"
    ? Math.min(999.9, Math.round(value * 10) / 10)
    : Math.round(value * 10) / 10;
  if (rounded < 10 || Number.isInteger(rounded)) return `${rounded.toFixed(rounded < 10 ? 1 : 0)}${suffix}`;
  return `${rounded.toFixed(1)}${suffix}`;
}
