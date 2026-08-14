import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import type { PointerTouch } from "@babylonjs/core/Events/pointerEvents";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

export const TABLE_WIDTH = 12;
export const TABLE_DEPTH = 7.2;
export const TABLE_SURFACE_Y = 0;
export const GRABBABLE_SIZE = 0.9;

export interface LightingGraph {
  shadows: ShadowGenerator;
}

class MultiTouchOnlyArcRotatePointersInput extends ArcRotateCameraPointersInput {
  override onTouch(point: PointerTouch | null, offsetX: number, offsetY: number): void {
    if (point?.type === "touch") return;
    super.onTouch(point, offsetX, offsetY);
  }

  override onMultiTouch(
    pointA: PointerTouch | null,
    pointB: PointerTouch | null,
    previousPinchSquaredDistance: number,
    pinchSquaredDistance: number,
    previousMultiTouchPanPosition: PointerTouch | null,
    multiTouchPanPosition: PointerTouch | null,
  ): void {
    if (pointA?.type === "touch" || pointB?.type === "touch") return;
    super.onMultiTouch(
      pointA,
      pointB,
      previousPinchSquaredDistance,
      pinchSquaredDistance,
      previousMultiTouchPanPosition,
      multiTouchPanPosition,
    );
  }
}

export function buildTableSurface(scene: Scene): Mesh {
  const felt = new StandardMaterial("table-felt", scene);
  felt.diffuseColor = Color3.FromHexString("#173f32");
  felt.specularColor = Color3.FromHexString("#07130f");
  felt.roughness = 0.92;

  const table = MeshBuilder.CreateBox(
    "table-surface",
    { width: TABLE_WIDTH, depth: TABLE_DEPTH, height: 0.42 },
    scene,
  );
  table.position.y = TABLE_SURFACE_Y - 0.21;
  table.material = felt;
  table.receiveShadows = true;
  table.isPickable = false;

  return table;
}

export function buildLighting(scene: Scene): LightingGraph {
  const ambient = new HemisphericLight("ambient-light", new Vector3(0, 1, 0), scene);
  ambient.diffuse = Color3.FromHexString("#d7eadf");
  ambient.groundColor = Color3.FromHexString("#101913");
  ambient.intensity = 0.78;

  const key = new DirectionalLight(
    "key-light",
    new Vector3(-0.55, -1, 0.4),
    scene,
  );
  key.position.set(5, 9, -5);
  key.diffuse = Color3.FromHexString("#fff1d7");
  key.intensity = 1.5;

  const shadows = new ShadowGenerator(1024, key);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 24;
  shadows.bias = 0.001;

  return { shadows };
}

export function buildCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
  const camera = new ArcRotateCamera(
    "table-camera",
    -Math.PI / 2,
    0.92,
    11.8,
    new Vector3(0, 0, 0),
    scene,
  );

  camera.lowerBetaLimit = 0.38;
  camera.upperBetaLimit = 1.32;
  camera.lowerRadiusLimit = 7.3;
  camera.upperRadiusLimit = 16;
  camera.panningDistanceLimit = 3.25;
  camera.panningSensibility = 175;
  camera.wheelPrecision = 42;
  camera.inertia = 0.72;
  camera.inputs.removeByType("ArcRotateCameraPointersInput");
  const pointers = new MultiTouchOnlyArcRotatePointersInput();
  pointers.angularSensibilityX = 1_000;
  pointers.angularSensibilityY = 1_000;
  pointers.pinchPrecision = 12;
  pointers.panningSensibility = camera.panningSensibility;
  camera.inputs.add(pointers);
  camera.attachControl(canvas, true);
  scene.activeCamera = camera;

  return camera;
}
