import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

import type { TableStyle } from "./sceneAdapter";
import { TABLE_DEPTH, TABLE_SURFACE_Y, TABLE_WIDTH } from "./tableDimensions";

export { GRABBABLE_SIZE, TABLE_DEPTH, TABLE_SURFACE_Y, TABLE_WIDTH } from "./tableDimensions";

const STYLE_COLORS: Record<TableStyle, { surface: string; fleck: string; rail: string; railDark: string }> = {
  "felt-green": { surface: "#173f32", fleck: "#245443", rail: "#5a3421", railDark: "#2d1912" },
  "dark-wood": { surface: "#3a2118", fleck: "#5a3424", rail: "#6a3e26", railDark: "#2b1710" },
  slate: { surface: "#30383a", fleck: "#465153", rail: "#332820", railDark: "#181311" },
  parchment: { surface: "#927b55", fleck: "#b19a70", rail: "#5c3520", railDark: "#2d1b13" },
};

export interface LightingGraph { shadows: ShadowGenerator | null }
export interface TableGraph {
  readonly surface: Mesh;
  setStyle(style: TableStyle): void;
}

function makeMaterial(scene: Scene, name: string, diffuse: string, specular = "#120d0a"): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(diffuse);
  result.specularColor = Color3.FromHexString(specular);
  result.roughness = 0.84;
  return result;
}

export function buildTableSurface(scene: Scene, initialStyle: TableStyle = "felt-green"): TableGraph {
  const addBox = (name: string, width: number, depth: number, height: number, y: number, color: string) => {
    const mesh = CreateBox(name, { width, depth, height }, scene);
    mesh.position.y = y;
    mesh.material = makeMaterial(scene, `${name}-material`, color);
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    return mesh;
  };

  addBox("room-floor", 50, 50, 0.12, -0.86, "#171713");
  const backWall = addBox("room-wall-back", 50, 0.18, 15, 6.55, "#24231f");
  backWall.position.z = -24;
  const sideWall = addBox("room-wall-side", 0.18, 50, 15, 6.55, "#1d201e");
  sideWall.position.x = -24;
  addBox("room-rug", 15, 12, 0.025, -0.78, "#332525");

  addBox("table-base", TABLE_WIDTH + 0.72, TABLE_DEPTH + 0.72, 0.38, TABLE_SURFACE_Y - 0.31, "#21130e");
  const table = addBox("table-surface", TABLE_WIDTH, TABLE_DEPTH, 0.12, TABLE_SURFACE_Y - 0.06, STYLE_COLORS[initialStyle].surface);
  const surfaceMaterial = table.material as StandardMaterial;
  const rails = [
    addBox("table-rail-north", TABLE_WIDTH + 0.78, 0.34, 0.3, TABLE_SURFACE_Y + 0.025, STYLE_COLORS[initialStyle].rail),
    addBox("table-rail-south", TABLE_WIDTH + 0.78, 0.34, 0.3, TABLE_SURFACE_Y + 0.025, STYLE_COLORS[initialStyle].rail),
    addBox("table-rail-west", 0.34, TABLE_DEPTH + 0.1, 0.3, TABLE_SURFACE_Y + 0.025, STYLE_COLORS[initialStyle].railDark),
    addBox("table-rail-east", 0.34, TABLE_DEPTH + 0.1, 0.3, TABLE_SURFACE_Y + 0.025, STYLE_COLORS[initialStyle].railDark),
  ];
  rails[0]!.position.z = -TABLE_DEPTH / 2 - 0.15;
  rails[1]!.position.z = TABLE_DEPTH / 2 + 0.15;
  rails[2]!.position.x = -TABLE_WIDTH / 2 - 0.15;
  rails[3]!.position.x = TABLE_WIDTH / 2 + 0.15;

  const grain: Mesh[] = [];
  for (let index = -4; index <= 4; index += 1) {
    const strip = addBox(`rail-grain-${index}`, 0.018, TABLE_DEPTH + 0.08, 0.012, TABLE_SURFACE_Y + 0.181, index % 2 === 0 ? "#9a6740" : "#6e4329");
    strip.position.x = index * 0.035 - TABLE_WIDTH / 2 - 0.15;
    grain.push(strip);
  }
  for (const x of [-TABLE_WIDTH / 2 - 0.15, TABLE_WIDTH / 2 + 0.15]) {
    for (const z of [-TABLE_DEPTH / 2 - 0.15, TABLE_DEPTH / 2 + 0.15]) {
      const cap = CreateCylinder("table-rail-cap", { height: 0.3, diameter: 0.36, tessellation: 32 }, scene);
      cap.position.set(x, TABLE_SURFACE_Y + 0.025, z);
      cap.material = rails[0]!.material;
      cap.isPickable = false;
    }
  }

  const weave: Mesh[] = [];
  for (let index = -5; index <= 5; index += 1) {
    const line = addBox(`surface-weave-${index}`, TABLE_WIDTH - 0.12, 0.008, 0.003, TABLE_SURFACE_Y + 0.002, STYLE_COLORS[initialStyle].fleck);
    line.position.z = index * 0.47;
    (line.material as StandardMaterial).alpha = 0.16;
    weave.push(line);
  }

  return {
    surface: table,
    setStyle(style) {
      const colors = STYLE_COLORS[style];
      surfaceMaterial.diffuseColor = Color3.FromHexString(colors.surface);
      rails.forEach((rail, index) => {
        (rail.material as StandardMaterial).diffuseColor = Color3.FromHexString(index < 2 ? colors.rail : colors.railDark);
      });
      weave.forEach((line) => { (line.material as StandardMaterial).diffuseColor = Color3.FromHexString(colors.fleck); });
      grain.forEach((line, index) => {
        (line.material as StandardMaterial).diffuseColor = Color3.FromHexString(index % 2 === 0 ? colors.rail : colors.railDark);
      });
    },
  };
}

export function buildLighting(scene: Scene, shadowsEnabled = true): LightingGraph {
  const ambient = new HemisphericLight("ambient-light", new Vector3(0, 1, 0), scene);
  ambient.diffuse = Color3.FromHexString("#d7d5c7");
  ambient.groundColor = Color3.FromHexString("#151915");
  ambient.intensity = 0.48;
  const key = new DirectionalLight("key-light", new Vector3(-0.55, -1, 0.4), scene);
  key.position.set(5, 9, -5);
  key.diffuse = Color3.FromHexString("#ffd9a8");
  key.intensity = 1.12;
  const fill = new PointLight("fill-light", new Vector3(-5.5, 4.5, 2.5), scene);
  fill.diffuse = Color3.FromHexString("#b8d7e8");
  fill.intensity = 0.34;
  fill.range = 18;
  const rim = new DirectionalLight("rim-light", new Vector3(0.45, -0.8, -0.65), scene);
  rim.diffuse = Color3.FromHexString("#ffd0a1");
  rim.intensity = 0.42;
  const shadows = shadowsEnabled ? new ShadowGenerator(1024, key) : null;
  if (shadows !== null) {
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias = 0.0007;
    shadows.normalBias = 0.02;
  }
  return { shadows };
}

export function buildCamera(scene: Scene): ArcRotateCamera {
  const camera = new ArcRotateCamera("table-camera", -Math.PI / 2, 0.92, 11.8, new Vector3(0, 0, 0), scene);
  camera.lowerBetaLimit = 0.38;
  camera.upperBetaLimit = 1.32;
  camera.lowerRadiusLimit = 6.7;
  camera.upperRadiusLimit = 24;
  camera.panningDistanceLimit = 3.25;
  camera.panningSensibility = 175;
  camera.wheelPrecision = 42;
  camera.inertia = 0.82;
  scene.activeCamera = camera;
  return camera;
}
