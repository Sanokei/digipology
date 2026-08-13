import { describe, expect, it } from "bun:test";

import { intersectRayWithHorizontalPlaneToRef } from "./dragBehavior";

describe("intersectRayWithHorizontalPlaneToRef", () => {
  it("finds the expected point on a table-parallel plane", () => {
    const result = { x: 0, y: 0, z: 0 };
    const hit = intersectRayWithHorizontalPlaneToRef(
      {
        origin: { x: 2, y: 6, z: -1 },
        direction: { x: 0.5, y: -1, z: 0.25 },
      },
      1,
      result,
    );

    expect(hit).toBe(true);
    expect(result).toEqual({ x: 4.5, y: 1, z: 0.25 });
  });

  it("rejects a ray parallel to the plane", () => {
    const result = { x: 7, y: 8, z: 9 };
    const hit = intersectRayWithHorizontalPlaneToRef(
      {
        origin: { x: 0, y: 3, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
      },
      1,
      result,
    );

    expect(hit).toBe(false);
    expect(result).toEqual({ x: 7, y: 8, z: 9 });
  });

  it("rejects an intersection behind the ray origin", () => {
    const result = { x: 0, y: 0, z: 0 };
    expect(
      intersectRayWithHorizontalPlaneToRef(
        {
          origin: { x: 0, y: 2, z: 0 },
          direction: { x: 0, y: 1, z: 0 },
        },
        0,
        result,
      ),
    ).toBe(false);
  });
});
