export type QuaternionTuple = readonly [number, number, number, number];

export function easeOutCubic(progress: number): number {
  const value = Math.min(Math.max(progress, 0), 1);
  return 1 - (1 - value) ** 3;
}

export function settleBounce(progress: number): number {
  const value = Math.min(Math.max(progress, 0), 1);
  return Math.sin(value * Math.PI) * (1 - value);
}

export function normalizeQuaternion(value: QuaternionTuple): [number, number, number, number] {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length, value[3] / length];
}

export function slerpQuaternion(
  from: QuaternionTuple,
  to: QuaternionTuple,
  progress: number,
): [number, number, number, number] {
  const amount = Math.min(Math.max(progress, 0), 1);
  let dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + from[3] * to[3];
  const target: [number, number, number, number] = dot < 0
    ? [-to[0], -to[1], -to[2], -to[3]]
    : [to[0], to[1], to[2], to[3]];
  dot = Math.abs(dot);
  if (dot > 0.9995) return normalizeQuaternion([
    from[0] + (target[0] - from[0]) * amount,
    from[1] + (target[1] - from[1]) * amount,
    from[2] + (target[2] - from[2]) * amount,
    from[3] + (target[3] - from[3]) * amount,
  ]);
  const theta = Math.acos(Math.min(dot, 1));
  const scale = Math.sin(theta);
  const left = Math.sin((1 - amount) * theta) / scale;
  const right = Math.sin(amount * theta) / scale;
  return [
    from[0] * left + target[0] * right,
    from[1] * left + target[1] * right,
    from[2] * left + target[2] * right,
    from[3] * left + target[3] * right,
  ];
}

/** Cosmetic tumble. Progress 1 is exactly the canonical target quaternion. */
export function tumbleQuaternion(
  target: QuaternionTuple,
  progress: number,
  turns = 2.5,
): [number, number, number, number] {
  const value = Math.min(Math.max(progress, 0), 1);
  if (value === 1) return [...target];
  const remaining = (1 - easeOutCubic(value)) * Math.PI * 2 * turns;
  const half = remaining / 2;
  const tumble: QuaternionTuple = [
    Math.sin(half) * 0.72,
    Math.sin(half) * 0.42,
    Math.sin(half) * 0.55,
    Math.cos(half),
  ];
  const normalized = normalizeQuaternion(tumble);
  return normalizeQuaternion([
    normalized[3] * target[0] + normalized[0] * target[3] + normalized[1] * target[2] - normalized[2] * target[1],
    normalized[3] * target[1] - normalized[0] * target[2] + normalized[1] * target[3] + normalized[2] * target[0],
    normalized[3] * target[2] + normalized[0] * target[1] - normalized[1] * target[0] + normalized[2] * target[3],
    normalized[3] * target[3] - normalized[0] * target[0] - normalized[1] * target[1] - normalized[2] * target[2],
  ]);
}
