interface Vector3Like { x: number; y: number; z: number }

export interface OrbitCameraLike {
  alpha: number;
  beta: number;
  radius: number;
  fov: number;
  target: Vector3Like;
}

function normalize(vector: Vector3Like): Vector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross(left: Vector3Like, right: Vector3Like): Vector3Like {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function dot(left: Vector3Like, right: Vector3Like): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function projectWorldToScreen(
  camera: OrbitCameraLike,
  width: number,
  height: number,
  point: Vector3Like,
): { x: number; y: number } | null {
  if (width <= 0 || height <= 0) return null;
  const sinBeta = Math.sin(camera.beta);
  const origin = {
    x: camera.target.x + camera.radius * Math.cos(camera.alpha) * sinBeta,
    y: camera.target.y + camera.radius * Math.cos(camera.beta),
    z: camera.target.z + camera.radius * Math.sin(camera.alpha) * sinBeta,
  };
  const forward = normalize({
    x: camera.target.x - origin.x,
    y: camera.target.y - origin.y,
    z: camera.target.z - origin.z,
  });
  const right = normalize(cross({ x: 0, y: 1, z: 0 }, forward));
  const up = normalize(cross(forward, right));
  const relative = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
  const depth = dot(relative, forward);
  if (depth <= 0) return null;
  const halfHeight = Math.tan(camera.fov / 2) * depth;
  const halfWidth = halfHeight * (width / height);
  const ndcX = dot(relative, right) / halfWidth;
  const ndcY = dot(relative, up) / halfHeight;
  const x = (ndcX + 1) * width / 2;
  const y = (1 - ndcY) * height / 2;
  return x < 0 || y < 0 || x > width || y > height ? null : { x, y };
}
