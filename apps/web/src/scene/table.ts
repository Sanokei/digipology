import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import type { PointerTouch } from "@babylonjs/core/Events/pointerEvents";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
// Registers shadow render targets with Scene; ShadowGenerator construction otherwise throws.
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

import { TABLE_DEPTH, TABLE_SURFACE_Y, TABLE_WIDTH } from "./tableDimensions";

export { GRABBABLE_SIZE, TABLE_DEPTH, TABLE_SURFACE_Y, TABLE_WIDTH } from "./tableDimensions";

export interface LightingGraph {
  shadows: ShadowGenerator | null;
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
  const makeMaterial = (name: string, diffuse: string, specular = "#120d0a") => {
    const result = new StandardMaterial(name, scene);
    result.diffuseColor = Color3.FromHexString(diffuse);
    result.specularColor = Color3.FromHexString(specular);
    result.roughness = 0.88;
    return result;
  };
  const addBox = (
    name: string,
    width: number,
    depth: number,
    height: number,
    y: number,
    color: string,
  ) => {
    const mesh = CreateBox(name, { width, depth, height }, scene);
    mesh.position.y = y;
    mesh.material = makeMaterial(`${name}-material`, color);
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    return mesh;
  };

  addBox("floor", 40, 40, 0.08, -0.82, "#090d0c");
  addBox(
    "table-base",
    TABLE_WIDTH + 0.62,
    TABLE_DEPTH + 0.62,
    0.34,
    TABLE_SURFACE_Y - 0.29,
    "#17110f",
  );

  const table = CreateBox(
    "table-surface",
    { width: TABLE_WIDTH, depth: TABLE_DEPTH, height: 0.12 },
    scene,
  );
  table.position.y = TABLE_SURFACE_Y - 0.06;
  table.material = makeMaterial("table-felt-material", "#123529", "#06110d");
  table.receiveShadows = true;
  table.isPickable = false;

  const north = addBox("table-rail-north", TABLE_WIDTH + 0.7, 0.3, 0.28, TABLE_SURFACE_Y + 0.02, "#33231b");
  const south = addBox("table-rail-south", TABLE_WIDTH + 0.7, 0.3, 0.28, TABLE_SURFACE_Y + 0.02, "#33231b");
  const west = addBox("table-rail-west", 0.3, TABLE_DEPTH + 0.1, 0.28, TABLE_SURFACE_Y + 0.02, "#2b1d17");
  const east = addBox("table-rail-east", 0.3, TABLE_DEPTH + 0.1, 0.28, TABLE_SURFACE_Y + 0.02, "#2b1d17");
  north.position.z = -TABLE_DEPTH / 2 - 0.14;
  south.position.z = TABLE_DEPTH / 2 + 0.14;
  west.position.x = -TABLE_WIDTH / 2 - 0.14;
  east.position.x = TABLE_WIDTH / 2 + 0.14;

  return table;
}

export function buildLighting(scene: Scene, shadowsEnabled = true): LightingGraph {
  const ambient = new HemisphericLight("ambient-light", new Vector3(0, 1, 0), scene);
  ambient.diffuse = Color3.FromHexString("#c7ddd1");
  ambient.groundColor = Color3.FromHexString("#090d0b");
  ambient.intensity = 0.44;

  const key = new DirectionalLight(
    "key-light",
    new Vector3(-0.55, -1, 0.4),
    scene,
  );
  key.position.set(5, 9, -5);
  key.diffuse = Color3.FromHexString("#fff1d7");
  key.intensity = 0.95;

  const shadows = shadowsEnabled ? new ShadowGenerator(1024, key) : null;
  if (shadows !== null) {
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 24;
    shadows.bias = 0.001;
  }

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
