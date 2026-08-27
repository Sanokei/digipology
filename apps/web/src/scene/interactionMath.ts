export interface QuaternionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export function multiplyQuaternion(a: QuaternionLike, b: QuaternionLike): [number, number, number, number] {
  const result: [number, number, number, number] = [
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  ];
  const length = Math.hypot(...result) || 1;
  return result.map((value) => value / length) as [number, number, number, number];
}

export function rotateQuaternionY(quaternion: QuaternionLike, radians: number): [number, number, number, number] {
  const half = radians / 2;
  return multiplyQuaternion(quaternion, { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
}

export function flipQuaternion(quaternion: QuaternionLike): [number, number, number, number] {
  return multiplyQuaternion(quaternion, { x: 1, y: 0, z: 0, w: 0 });
}
