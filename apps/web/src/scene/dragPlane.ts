export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface MutableVector3Like extends Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface RayLike {
  origin: Vector3Like;
  direction: Vector3Like;
}

/**
 * Intersects a ray with a horizontal plane without allocating an output value.
 * Returns false for parallel rays and intersections behind the ray origin.
 */
export function intersectRayWithHorizontalPlaneToRef(
  ray: RayLike,
  planeY: number,
  result: MutableVector3Like,
): boolean {
  const denominator = ray.direction.y;
  if (Math.abs(denominator) < 1e-8) return false;
  const distance = (planeY - ray.origin.y) / denominator;
  if (distance < 0 || !Number.isFinite(distance)) return false;
  result.x = ray.origin.x + ray.direction.x * distance;
  result.y = planeY;
  result.z = ray.origin.z + ray.direction.z * distance;
  return Number.isFinite(result.x) && Number.isFinite(result.y) && Number.isFinite(result.z);
}

