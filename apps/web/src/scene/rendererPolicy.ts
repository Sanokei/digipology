export function clampDevicePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(Math.max(devicePixelRatio, 1), 2);
}

export function hardwareScalingLevel(devicePixelRatio: number): number {
  return 1 / clampDevicePixelRatio(devicePixelRatio);
}
