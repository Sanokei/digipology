import { expect, test } from "bun:test";

import { projectWorldToScreen } from "./cameraProjection";

const camera = {
  alpha: -Math.PI / 2,
  beta: Math.PI / 3,
  radius: 10,
  fov: 0.8,
  target: { x: 0, y: 0, z: 0 },
};

test("projects the orbit target to screen center and hides points behind the camera", () => {
  expect(projectWorldToScreen(camera, 800, 600, camera.target)).toEqual({ x: 400, y: 300 });
  expect(projectWorldToScreen(camera, 800, 600, { x: 0, y: 12, z: 12 })).toBeNull();
});

test("world-space left and right remain ordered in the overlay projection", () => {
  const left = projectWorldToScreen(camera, 800, 600, { x: -1, y: 0, z: 0 });
  const right = projectWorldToScreen(camera, 800, 600, { x: 1, y: 0, z: 0 });
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  expect(left!.x).toBeLessThan(right!.x);
});
