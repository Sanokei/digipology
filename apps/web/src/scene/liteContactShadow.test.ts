import { expect, test } from "bun:test";
import { horizontalShadowRotation } from "./liteContactShadow";

test("a yawed shadow remains flat on the table in Lite's quaternion order", () => {
  for (const yaw of [0, Math.PI / 3, Math.PI, 4]) {
    const [x, y, z, w] = horizontalShadowRotation(yaw);
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 8);
    const normal = [-2 * (x * z + w * y), -2 * (y * z - w * x), -1 + 2 * (x * x + y * y)];
    expect(normal[0]).toBeCloseTo(0, 8); expect(normal[1]).toBeCloseTo(1, 8); expect(normal[2]).toBeCloseTo(0, 8);
  }
});
