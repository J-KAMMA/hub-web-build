import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

import {
  PLAZA_BENCHES,
  PLAZA_BUILDINGS,
  PLAZA_CAFE_POCKETS,
  PLAZA_FOUNTAIN,
  PLAZA_PLANTERS,
  type PlazaBench,
  type PlazaBuilding,
  type PlazaCafePocket,
  type PlazaPlanter,
  type PlazaSolid
} from "../world/plaza";

type Palette = {
  pavement: StandardMaterial;
  path: StandardMaterial;
  pathAccent: StandardMaterial;
  cream: StandardMaterial;
  terracotta: StandardMaterial;
  lime: StandardMaterial;
  roof: StandardMaterial;
  dark: StandardMaterial;
  glass: StandardMaterial;
  shutter: StandardMaterial;
  stone: StandardMaterial;
  stoneLight: StandardMaterial;
  soil: StandardMaterial;
  grass: StandardMaterial;
  trunk: StandardMaterial;
  foliage: StandardMaterial;
  foliageLight: StandardMaterial;
  wood: StandardMaterial;
  woodDark: StandardMaterial;
  metal: StandardMaterial;
  ochre: StandardMaterial;
  teal: StandardMaterial;
  water: StandardMaterial;
};

const material = (scene: Scene, name: string, color: Color3, roughness = 0.84): StandardMaterial => {
  const made = new StandardMaterial(`plaza:${name}`, scene);
  made.diffuseColor = color;
  made.specularColor = new Color3(0.04, 0.035, 0.03);
  made.roughness = roughness;
  if (name === "window-glass") {
    made.emissiveColor.set(0.055, 0.09, 0.10);
    made.specularColor.set(0.5, 0.55, 0.6);
    made.specularPower = 96;
  }
  // Authored surface grain instead of uniformly coloured plastic surfaces.
  if (typeof document !== "undefined" && /pavement|path$|limestone|terracotta|limewash|stone|wood|trunk|roof/.test(name)) {
    const texture = new DynamicTexture(`plaza:${name}-surface`, 256, scene, true);
    const ctx = texture.getContext();
    let seed = 719;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    ctx.fillStyle = "#d8d8d8"; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 18000; i++) {
      const shade = Math.floor(180 + random() * 70);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(random() * 256, random() * 256, 1, /wood|trunk/.test(name) ? 14 : 1);
    }
    if (/pavement|path$/.test(name)) {
      ctx.fillStyle = "#999999";
      for (let row = 0; row < 4; row++) {
        ctx.fillRect(0, row * 64, 256, 1);
        for (let col = 0; col < 4; col++) ctx.fillRect(col * 64 + (row % 2) * 32, row * 64, 1, 64);
      }
      texture.uScale = texture.vScale = name === "pavement" ? 24 : 8;
    } else texture.uScale = texture.vScale = 3;
    texture.update(); made.diffuseTexture = texture;
  }
  return made;
};

function palette(scene: Scene): Palette {
  return {
    pavement: material(scene, "pavement", new Color3(0.63, 0.56, 0.47)),
    path: material(scene, "path", new Color3(0.78, 0.71, 0.60)),
    pathAccent: material(scene, "path-accent", new Color3(0.65, 0.34, 0.23)),
    cream: material(scene, "limestone", new Color3(0.82, 0.75, 0.62)),
    terracotta: material(scene, "terracotta", new Color3(0.65, 0.30, 0.25)),
    lime: material(scene, "limewash", new Color3(0.93, 0.86, 0.71)),
    roof: material(scene, "roof-tile", new Color3(0.38, 0.22, 0.16)),
    dark: material(scene, "door-recess", new Color3(0.075, 0.06, 0.055)),
    glass: material(scene, "window-glass", new Color3(0.10, 0.34, 0.38), 0.32),
    shutter: material(scene, "teal-shutter", new Color3(0.07, 0.35, 0.36)),
    stone: material(scene, "stone", new Color3(0.53, 0.51, 0.46)),
    stoneLight: material(scene, "stone-light", new Color3(0.74, 0.68, 0.57)),
    soil: material(scene, "soil", new Color3(0.22, 0.13, 0.08)),
    grass: material(scene, "planter-grass", new Color3(0.25, 0.37, 0.18)),
    trunk: material(scene, "olive-trunk", new Color3(0.28, 0.18, 0.10)),
    foliage: material(scene, "olive-foliage", new Color3(0.22, 0.35, 0.20)),
    foliageLight: material(scene, "olive-foliage-light", new Color3(0.35, 0.47, 0.25)),
    wood: material(scene, "bench-wood", new Color3(0.38, 0.21, 0.12)),
    woodDark: material(scene, "bench-dark", new Color3(0.20, 0.12, 0.075)),
    metal: material(scene, "railing", new Color3(0.24, 0.27, 0.23)),
    ochre: material(scene, "awning-ochre", new Color3(0.76, 0.48, 0.23)),
    teal: material(scene, "awning-teal", new Color3(0.11, 0.42, 0.42)),
    water: material(scene, "fountain-water", new Color3(0.08, 0.48, 0.57), 0.18)
  };
}

function finish(mesh: Mesh, skin: StandardMaterial, castShadow = true): Mesh {
  mesh.material = skin;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  const metadata = mesh.metadata && typeof mesh.metadata === "object" ? mesh.metadata : {};
  mesh.metadata = { ...metadata, castShadow };
  return mesh;
}

function pointAt(solid: PlazaSolid, localX: number, localZ: number): Vector3 {
  const turn = solid.turn ?? 0;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return new Vector3(
    solid.x + localX * cos - localZ * sin,
    0,
    solid.z + localX * sin + localZ * cos
  );
}

function boxAt(
  scene: Scene,
  name: string,
  width: number,
  depth: number,
  height: number,
  solid: PlazaSolid,
  localX: number,
  localZ: number,
  baseY: number,
  skin: StandardMaterial,
  turn = solid.turn ?? 0,
  tiltZ = 0
): Mesh {
  const made = CreateBox(`plaza:${name}`, { width, depth, height }, scene);
  const at = pointAt(solid, localX, localZ);
  made.position = new Vector3(at.x, baseY + height / 2, at.z);
  made.rotation.y = -turn;
  made.rotation.z = tiltZ;
  return finish(made, skin);
}

function boxWorld(
  scene: Scene,
  name: string,
  width: number,
  depth: number,
  height: number,
  x: number,
  y: number,
  z: number,
  skin: StandardMaterial,
  rotationY = 0
): Mesh {
  const made = CreateBox(`plaza:${name}`, { width, depth, height }, scene);
  made.position = new Vector3(x, y, z);
  made.rotation.y = rotationY;
  return finish(made, skin);
}

function boxAtCenterY(
  scene: Scene,
  name: string,
  width: number,
  depth: number,
  height: number,
  solid: PlazaSolid,
  localX: number,
  localZ: number,
  centerY: number,
  skin: StandardMaterial,
  tiltZ = 0
): Mesh {
  return boxAt(scene, name, width, depth, height, solid, localX, localZ, centerY - height / 2, skin, solid.turn ?? 0, tiltZ);
}

function cylinderBetween(
  scene: Scene,
  name: string,
  start: Vector3,
  end: Vector3,
  diameter: number,
  skin: StandardMaterial,
  tessellation = 10
): Mesh {
  const direction = end.subtract(start);
  const length = direction.length();
  const made = CreateCylinder(`plaza:${name}`, { diameter, height: length, tessellation }, scene);
  made.position = start.add(end).scale(0.5);
  made.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), new Quaternion());
  return finish(made, skin);
}

/** A triangular gable filler gives the roof a real silhouette from the plaza. */
function gableFiller(
  scene: Scene,
  name: string,
  width: number,
  depth: number,
  ridge: number,
  baseY: number,
  solid: PlazaSolid,
  skin: StandardMaterial
): Mesh {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const positions = [
    -halfWidth, 0, -halfDepth,
    halfWidth, 0, -halfDepth,
    0, ridge, -halfDepth,
    -halfWidth, 0, halfDepth,
    halfWidth, 0, halfDepth,
    0, ridge, halfDepth
  ];
  const indices = [
    0, 1, 2,
    5, 4, 3,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0
  ];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = [
    0, 0, 1, 0, 0.5, 1,
    0, 0, 1, 0, 0.5, 1
  ];
  const made = new Mesh(`plaza:${name}`, scene);
  data.applyToMesh(made);
  const at = pointAt(solid, 0, 0);
  made.position = new Vector3(at.x, baseY, at.z);
  made.rotation.y = -(solid.turn ?? 0);
  return finish(made, skin);
}

function buildPavement(scene: Scene, radius: number, skins: Palette): void {
  const ground = CreateGround("plaza:ground", { width: radius * 2, height: radius * 2, subdivisions: 2 }, scene);
  finish(ground, skins.pavement, false);

  const extent = Math.max(28, Math.min(radius - 2, 52));
  for (let offset = -extent; offset <= extent; offset += 6) {
    boxWorld(scene, `paving-joint-x-${offset}`, extent * 2, 0.035, 0.012, 0, 0.006, offset, skins.stone);
    boxWorld(scene, `paving-joint-z-${offset}`, 0.035, extent * 2, 0.012, offset, 0.006, 0, skins.stone);
  }

  // Two broad limestone paths preserve the five metre north/south and east/west approaches.
  boxWorld(scene, "path-north-south", 5.0, radius * 2 - 2, 0.016, 0, 0.008, 0, skins.path);
  boxWorld(scene, "path-east-west", radius * 2 - 2, 5.0, 0.016, 0, 0.008, 0, skins.path);

  const medallion = CreateCylinder("plaza:gathering-medallion", { diameter: 13.6, height: 0.018, tessellation: 64 }, scene);
  medallion.position.y = 0.009;
  finish(medallion, skins.path);
  const ring = CreateTorus("plaza:gathering-medallion-ring", { diameter: 13.4, thickness: 0.10, tessellation: 64 }, scene);
  ring.position.y = 0.024;
  finish(ring, skins.pathAccent);
  const innerRing = CreateTorus("plaza:gathering-medallion-inner", { diameter: 7.5, thickness: 0.06, tessellation: 48 }, scene);
  innerRing.position.y = 0.026;
  finish(innerRing, skins.stoneLight);
  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    const x = Math.sin(angle) * 4.8;
    const z = Math.cos(angle) * 4.8;
    const accent = boxWorld(scene, `medallion-inlay-${angle.toFixed(2)}`, 0.32, 2.0, 0.014, x, 0.02, z, skins.pathAccent, angle);
    accent.receiveShadows = true;
  }
  for (const mesh of scene.meshes) {
    if (/^plaza:(?:ground|paving-joint|path-|gathering-medallion|medallion-inlay)/.test(mesh.name)) {
      mesh.metadata = { castShadow: false };
    }
  }
}

function addWindow(
  scene: Scene,
  building: PlazaBuilding,
  skins: Palette,
  name: string,
  localX: number,
  bottomY: number,
  width: number,
  height: number,
  shutters = true
): void {
  const facade = -building.depth / 2 - 0.045;
  boxAt(scene, `${name}-recess`, width, 0.10, height, building, localX, facade, bottomY, skins.dark);
  boxAt(scene, `${name}-glass`, width - 0.28, 0.025, height - 0.24, building, localX, facade - 0.062, bottomY + 0.12, skins.glass);
  const frameWidth = 0.10;
  boxAt(scene, `${name}-frame-left`, frameWidth, 0.13, height + 0.16, building, localX - width / 2 - 0.05, facade - 0.06, bottomY - 0.08, skins.lime);
  boxAt(scene, `${name}-frame-right`, frameWidth, 0.13, height + 0.16, building, localX + width / 2 + 0.05, facade - 0.06, bottomY - 0.08, skins.lime);
  boxAt(scene, `${name}-frame-top`, width + 0.20, 0.13, frameWidth, building, localX, facade - 0.06, bottomY + height, skins.lime);
  boxAt(scene, `${name}-frame-bottom`, width + 0.20, 0.13, frameWidth, building, localX, facade - 0.06, bottomY - 0.03, skins.lime);
  boxAt(scene, `${name}-sill`, width + 0.30, 0.22, 0.12, building, localX, facade - 0.12, bottomY - 0.16, skins.stoneLight);
  if (shutters) {
    boxAt(scene, `${name}-shutter-left`, 0.34, 0.11, height + 0.02, building, localX - width / 2 - 0.28, facade - 0.03, bottomY, skins.shutter);
    boxAt(scene, `${name}-shutter-right`, 0.34, 0.11, height + 0.02, building, localX + width / 2 + 0.28, facade - 0.03, bottomY, skins.shutter);
    for (const side of [-1, 1]) {
      for (let slat = 0; slat < 3; slat += 1) {
        boxAt(scene, `${name}-shutter-${side}-${slat}`, 0.38, 0.018, 0.035, building,
          localX + side * (width / 2 + 0.28), facade - 0.095, bottomY + 0.16 + slat * (height / 4), skins.lime);
      }
    }
  }
}

function addDoor(scene: Scene, building: PlazaBuilding, skins: Palette, name: string, localX: number, width: number, height: number): void {
  const facade = -building.depth / 2 - 0.07;
  boxAt(scene, `${name}-recess`, width, 0.14, height, building, localX, facade, 0.04, skins.dark);
  boxAt(scene, `${name}-left-frame`, 0.15, 0.18, height + 0.24, building, localX - width / 2 - 0.10, facade - 0.06, -0.02, skins.stoneLight);
  boxAt(scene, `${name}-right-frame`, 0.15, 0.18, height + 0.24, building, localX + width / 2 + 0.10, facade - 0.06, -0.02, skins.stoneLight);
  boxAt(scene, `${name}-lintel`, width + 0.35, 0.18, 0.18, building, localX, facade - 0.06, height + 0.12, skins.stoneLight);
  boxAt(scene, `${name}-handle`, 0.08, 0.08, 0.16, building, localX + width * 0.25, facade - 0.15, 1.10, skins.metal);
}

function addBalcony(scene: Scene, building: PlazaBuilding, skins: Palette, name: string, localX: number, floorY: number, width: number): void {
  const front = -building.depth / 2 - 0.55;
  boxAtCenterY(scene, `${name}-slab`, width, 1.05, 0.18, building, localX, front + 0.38, floorY, skins.stoneLight);
  const railY = floorY + 0.52;
  boxAtCenterY(scene, `${name}-front-rail`, width, 0.10, 0.10, building, localX, front, railY + 0.43, skins.metal);
  for (const railX of [-width / 2, -width / 4, 0, width / 4, width / 2]) {
    boxAtCenterY(scene, `${name}-post-${railX}`, 0.08, 0.08, 0.86, building, localX + railX, front, railY, skins.metal);
  }
  for (const side of [-1, 1]) {
    boxAtCenterY(scene, `${name}-side-rail-${side}`, 0.10, 1.0, 0.10, building, localX + side * width / 2, front + 0.40, railY + 0.43, skins.metal);
  }
}

function buildRoof(scene: Scene, building: PlazaBuilding, skins: Palette): void {
  if (building.roof === "gable") {
    const ridge = building.width > 8 ? 1.25 : 1.05;
    gableFiller(scene, `${building.id}-gable`, building.width + 0.04, building.depth + 0.04, ridge, building.height, building, skins.lime);
    const slope = Math.sqrt((building.width / 2) ** 2 + ridge ** 2) + 0.12;
    const pitch = Math.atan2(ridge, building.width / 2);
    boxAtCenterY(scene, `${building.id}-roof-left`, slope, building.depth + 0.45, 0.18, building,
      -building.width * 0.24, 0, building.height + ridge * 0.5, skins.roof, pitch);
    boxAtCenterY(scene, `${building.id}-roof-right`, slope, building.depth + 0.45, 0.18, building,
      building.width * 0.24, 0, building.height + ridge * 0.5, skins.roof, -pitch);
    boxAtCenterY(scene, `${building.id}-ridge`, 0.22, building.depth + 0.48, 0.22, building, 0, 0, building.height + ridge, skins.roof);
    return;
  }
  boxAt(scene, `${building.id}-terrace`, building.width + 0.18, building.depth + 0.18, 0.22, building, 0, 0, building.height, skins.roof);
  const parapetY = building.height + 0.22;
  boxAtCenterY(scene, `${building.id}-parapet-front`, building.width + 0.12, 0.18, 0.42, building, 0, -building.depth / 2 + 0.05, parapetY + 0.21, skins.lime);
  boxAtCenterY(scene, `${building.id}-parapet-back`, building.width + 0.12, 0.18, 0.42, building, 0, building.depth / 2 - 0.05, parapetY + 0.21, skins.lime);
  for (const side of [-1, 1]) {
    boxAtCenterY(scene, `${building.id}-parapet-side-${side}`, 0.18, building.depth, 0.42, building,
      side * (building.width / 2 - 0.05), 0, parapetY + 0.21, skins.lime);
  }
}

function buildBuilding(scene: Scene, building: PlazaBuilding, skins: Palette): void {
  const facade = -building.depth / 2;
  boxAt(scene, building.id, building.width, building.depth, building.height, building, 0, 0, 0, skins[building.palette]);
  boxAt(scene, `${building.id}-plinth`, building.width + 0.30, building.depth + 0.20, 0.22, building, 0, 0, 0.02, skins.stoneLight);
  boxAt(scene, `${building.id}-cornice`, building.width + 0.36, building.depth + 0.22, 0.24, building, 0, 0, building.height - 0.20, skins.lime);
  buildRoof(scene, building, skins);

  if (building.style === "arcade") {
    addDoor(scene, building, skins, `${building.id}-entry`, 0, 1.45, 2.55);
    for (const opening of [-3.34, 0, 3.34]) {
      const recess = CreateCylinder(`plaza:${building.id}-arch-recess-${opening}`, { diameter: 2.44, height: 0.025, tessellation: 40 }, scene);
      const center = pointAt(building, opening, facade - 0.025);
      recess.position.set(center.x, 1.76, center.z);
      recess.rotation.x = Math.PI / 2;
      finish(recess, skins.dark, false);
      boxAt(scene, `${building.id}-arch-dark-${opening}`, 2.44, 0.028, 1.76, building, opening, facade - 0.025, 0, skins.dark);
      for (let segment = 0; segment <= 16; segment++) {
        const angle = segment * Math.PI / 16;
        boxAtCenterY(scene, `${building.id}-arch-stone-${opening}-${segment}`, 0.26, 0.24, 0.23, building,
          opening + Math.cos(angle) * 1.34, facade - 0.15, 1.76 + Math.sin(angle) * 1.34,
          skins.stoneLight, angle + Math.PI / 2);
      }
    }
    for (const x of [-5.0, -1.67, 1.67, 5.0]) {
      const column = pointAt(building, x, facade - 0.10);
      const pillar = CreateCylinder(`plaza:${building.id}-column-${x}`, { diameter: 0.42, height: 2.95, tessellation: 12 }, scene);
      pillar.position = new Vector3(column.x, 1.48, column.z);
      pillar.rotation.y = -building.turn;
      finish(pillar, skins.stoneLight);
      boxAtCenterY(scene, `${building.id}-capital-${x}`, 0.68, 0.64, 0.18, building, x, facade - 0.10, 3.03, skins.lime);
    }
    boxAtCenterY(scene, `${building.id}-arcade-lintel`, building.width - 0.18, 0.46, 0.26, building, 0, facade - 0.08, 3.20, skins.lime);
    for (const x of [-4.5, 0, 4.5]) addWindow(scene, building, skins, `${building.id}-upper-${x}`, x, 4.15, 1.85, 1.45);
    addBalcony(scene, building, skins, `${building.id}-balcony`, 0, 3.35, 3.6);
  } else if (building.style === "landmark") {
    addDoor(scene, building, skins, `${building.id}-entry`, 0, 1.30, 2.35);
    for (const [floor, y] of [[0, 1.45], [1, 4.03], [2, 6.60]] as const) {
      addWindow(scene, building, skins, `${building.id}-window-${floor}`, 0, y, 1.55, 1.38);
    }
    addBalcony(scene, building, skins, `${building.id}-balcony`, 0, 4.02, 3.30);
    boxAtCenterY(scene, `${building.id}-vertical-band-left`, 0.18, 0.16, building.height - 0.35, building,
      -building.width / 2 + 0.22, facade - 0.09, building.height / 2, skins.lime);
    boxAtCenterY(scene, `${building.id}-vertical-band-right`, 0.18, 0.16, building.height - 0.35, building,
      building.width / 2 - 0.22, facade - 0.09, building.height / 2, skins.lime);
  } else {
    addDoor(scene, building, skins, `${building.id}-entry`, 0, 1.45, 2.30);
    addWindow(scene, building, skins, `${building.id}-shop-left`, -2.85, 0.76, 2.55, 2.05, false);
    addWindow(scene, building, skins, `${building.id}-shop-right`, 2.85, 0.76, 2.55, 2.05, false);
    for (const x of [-2.6, 2.6]) addWindow(scene, building, skins, `${building.id}-upper-${x}`, x, 3.78, 1.55, 1.35);
    const awningY = 3.02;
    boxAtCenterY(scene, `${building.id}-awning`, building.width * 0.86, 1.0, 0.14, building, 0, facade - 0.54, awningY, skins.pathAccent);
    for (const stripe of [-3, -1, 1, 3]) {
      boxAtCenterY(scene, `${building.id}-awning-stripe-${stripe}`, 0.32, 1.01, 0.025, building,
        stripe * building.width / 10, facade - 0.55, awningY - 0.08, skins.lime);
    }
    if (typeof document !== "undefined") {
      const canvas = new DynamicTexture(`plaza:${building.id}-lettering`, { width: 512, height: 96 }, scene, true);
      canvas.drawText(building.palette === "terracotta" ? "CAFÉ DU PORT" : "ATELIER", null, 62,
        "38px Georgia, serif", "#eee2c4", "#254745", true);
      const lettering = new StandardMaterial(`plaza:${building.id}-sign`, scene);
      lettering.diffuseTexture = canvas; lettering.emissiveColor.set(0.25, 0.25, 0.25);
      lettering.specularColor.set(0, 0, 0);
      const sign = CreatePlane(`plaza:${building.id}-sign`, { width: 3.8, height: 0.7 }, scene);
      const at = pointAt(building, 0, facade - 0.15);
      sign.position.set(at.x, 3.55, at.z); sign.rotation.y = -building.turn;
      finish(sign, lettering, false);
    }
  }
}

type Cluster = readonly [number, number, number, number, number, number];

const OLIVE_CLUSTERS: readonly Cluster[] = [
  [-1.10, 3.05, 0.10, 1.25, 0.78, 1.00],
  [-0.52, 3.62, 0.20, 1.34, 0.86, 1.15],
  [0.22, 3.35, -0.12, 1.48, 0.82, 1.04],
  [0.95, 3.70, 0.10, 1.18, 0.74, 1.12],
  [-1.28, 4.18, -0.05, 1.20, 0.80, 1.02],
  [-0.50, 4.45, 0.12, 1.42, 0.88, 1.16],
  [0.32, 4.16, 0.22, 1.35, 0.84, 1.14],
  [1.12, 4.35, -0.06, 1.20, 0.80, 0.98],
  [-0.78, 5.02, 0.08, 1.18, 0.72, 0.96],
  [0.34, 4.90, -0.14, 1.34, 0.76, 1.06]
];

const OLIVE_BRANCHES: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.00, 2.35, 0.00, -1.10, 3.20, 0.10],
  [-0.10, 2.45, 0.05, 0.18, 3.45, 0.35],
  [0.04, 2.55, 0.00, 1.05, 3.38, -0.18],
  [0.10, 2.70, -0.04, -0.32, 3.78, -0.95],
  [0.10, 2.75, 0.02, 0.72, 3.90, 0.72]
];

function buildPlanter(scene: Scene, planter: PlazaPlanter, skins: Palette): void {
  const base = CreateCylinder(`plaza:${planter.id}`, { diameter: planter.radius * 2, height: 0.28, tessellation: 32 }, scene);
  base.position = new Vector3(planter.x, 0.14, planter.z);
  finish(base, skins.stone);
  const upper = CreateCylinder(`plaza:${planter.id}-upper`, { diameter: planter.radius * 1.78, height: 0.28, tessellation: 32 }, scene);
  upper.position = new Vector3(planter.x, 0.42, planter.z);
  finish(upper, skins.stoneLight);
  const soil = CreateCylinder(`plaza:${planter.id}-soil`, { diameter: planter.radius * 1.50, height: 0.12, tessellation: 32 }, scene);
  soil.position = new Vector3(planter.x, 0.65, planter.z);
  finish(soil, skins.soil);
  const grass = CreateCylinder(`plaza:${planter.id}-grass-bed`, { diameter: planter.radius * 1.34, height: 0.024, tessellation: 32 }, scene);
  grass.position = new Vector3(planter.x, 0.722, planter.z);
  finish(grass, skins.grass);
  const rim = CreateTorus(`plaza:${planter.id}-rim`, { diameter: planter.radius * 1.66, thickness: 0.10, tessellation: 32 }, scene);
  rim.position = new Vector3(planter.x, 0.74, planter.z);
  finish(rim, skins.stoneLight);

  const origin = new Vector3(planter.x, planter.height, planter.z);
  cylinderBetween(scene, `${planter.id}-trunk-lower`, origin, new Vector3(planter.x - 0.12, 2.35, planter.z + 0.02), 0.52, skins.trunk, 12);
  cylinderBetween(scene, `${planter.id}-trunk-upper`, new Vector3(planter.x - 0.12, 2.30, planter.z + 0.02), new Vector3(planter.x + 0.05, 3.12, planter.z + 0.04), 0.38, skins.trunk, 12);
  for (const [index, [sx, sy, sz, ex, ey, ez]] of OLIVE_BRANCHES.entries()) {
    cylinderBetween(scene, `${planter.id}-branch-${index}`, new Vector3(planter.x + sx, sy, planter.z + sz),
      new Vector3(planter.x + ex, ey, planter.z + ez), 0.18, skins.trunk, 9);
  }
  for (const [index, [x, y, z, sx, sy, sz]] of OLIVE_CLUSTERS.entries()) {
    const crown = new Mesh(`plaza:${planter.id}-olive-cluster-${index}`, scene);
    const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [];
    for (let leaf = 0; leaf < 120; leaf++) {
      const angle = leaf * 2.39996 + index;
      const vertical = (leaf / 119) * 2 - 1;
      const spread = Math.sqrt(1 - vertical * vertical) * (0.6 + (leaf % 7) / 17);
      const cx = planter.x + x + Math.cos(angle) * sx * spread * 0.65;
      const cy = y + vertical * sy * 0.7;
      const cz = planter.z + z + Math.sin(angle) * sz * spread * 0.65;
      const length = 0.15 + (leaf % 5) * 0.025, width = 0.045;
      const dx = Math.cos(angle) * length, dz = Math.sin(angle) * length;
      const wx = -Math.sin(angle) * width, wz = Math.cos(angle) * width;
      const start = positions.length / 3;
      positions.push(cx - dx, cy - 0.04, cz - dz, cx + wx, cy, cz + wz,
        cx + dx, cy + 0.06, cz + dz, cx - wx, cy, cz - wz);
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      uvs.push(0, 0.5, 0.5, 0, 1, 0.5, 0.5, 1);
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData(); Object.assign(data, { positions, indices, normals, uvs }); data.applyToMesh(crown);
    skins.foliage.backFaceCulling = skins.foliageLight.backFaceCulling = false;
    skins.foliage.twoSidedLighting = skins.foliageLight.twoSidedLighting = true;
    finish(crown, index % 3 === 0 ? skins.foliageLight : skins.foliage);
  }
}

function buildBench(scene: Scene, bench: PlazaBench, skins: Palette): void {
  for (let slat = -2; slat <= 2; slat += 1) {
    boxAtCenterY(scene, `${bench.id}-seat-slat-${slat}`, bench.width * 0.86, 0.13, 0.11, bench,
      0, slat * 0.15, 0.66, skins.wood);
  }
  for (const x of [-bench.width * 0.32, bench.width * 0.32]) {
    boxAtCenterY(scene, `${bench.id}-leg-${x}`, 0.18, 0.58, 0.52, bench, x, 0, 0.40, skins.woodDark);
    boxAtCenterY(scene, `${bench.id}-leg-foot-${x}`, 0.58, 0.16, 0.10, bench, x, 0, 0.15, skins.woodDark);
  }
  for (let backSlat = 0; backSlat < 3; backSlat += 1) {
    boxAtCenterY(scene, `${bench.id}-back-slat-${backSlat}`, bench.width * 0.86, 0.12, 0.12, bench,
      0, 0.30, 0.95 + backSlat * 0.22, skins.wood);
  }
  for (const x of [-bench.width * 0.42, bench.width * 0.42]) {
    boxAtCenterY(scene, `${bench.id}-arm-post-${x}`, 0.12, 0.12, 0.52, bench, x, 0.08, 0.78, skins.woodDark);
    boxAtCenterY(scene, `${bench.id}-arm-${x}`, 0.16, 0.72, 0.12, bench, x, 0.08, 1.04, skins.wood);
  }
}

function buildCafePocket(scene: Scene, cafe: PlazaCafePocket, skins: Palette): void {
  const canopySkin = cafe.canopy === "ochre" ? skins.ochre : skins.teal;
  const pole = CreateCylinder(`plaza:${cafe.id}-umbrella-pole`, { diameter: 0.10, height: 2.28, tessellation: 10 }, scene);
  pole.position = new Vector3(cafe.x, 1.82, cafe.z);
  finish(pole, skins.woodDark);
  const canopy = CreateCylinder(`plaza:${cafe.id}-umbrella`, { diameterTop: 0.25, diameterBottom: 3.75, height: 0.30, tessellation: 32 }, scene);
  canopy.position = new Vector3(cafe.x, 3.03, cafe.z);
  finish(canopy, canopySkin);
  const table = CreateCylinder(`plaza:${cafe.id}-table`, { diameter: 1.35, height: 0.12, tessellation: 24 }, scene);
  table.position = new Vector3(cafe.x, 0.77, cafe.z);
  finish(table, skins.stoneLight);
  const tableLeg = CreateCylinder(`plaza:${cafe.id}-table-leg`, { diameter: 0.16, height: 0.72, tessellation: 10 }, scene);
  tableLeg.position = new Vector3(cafe.x, 0.36, cafe.z);
  finish(tableLeg, skins.metal);
  for (const [index, angle] of [0.1, 2.2, 4.3].entries()) {
    const x = cafe.x + Math.cos(angle) * 1.22;
    const z = cafe.z + Math.sin(angle) * 1.22;
    boxWorld(scene, `${cafe.id}-chair-${index}`, 0.58, 0.58, 0.10, x, 0.42, z, skins.wood, angle + Math.PI);
    boxWorld(scene, `${cafe.id}-chair-back-${index}`, 0.58, 0.10, 0.48, x, 0.53, z - Math.sin(angle) * 0.20, skins.woodDark, angle + Math.PI);
    for (const side of [-1, 1]) boxWorld(scene, `${cafe.id}-chair-leg-${index}-${side}`, 0.065, 0.46, 0.42,
      x + side * 0.2, 0, z, skins.metal, angle + Math.PI);
  }
}

function buildFountain(scene: Scene, skins: Palette): void {
  const fountain = PLAZA_FOUNTAIN;
  const plinth = CreateCylinder("plaza:fountain-plinth", { diameter: 5.80, height: 0.24, tessellation: 48 }, scene);
  plinth.position = new Vector3(fountain.x, 0.12, fountain.z);
  finish(plinth, skins.stone);
  const lowerBowl = CreateCylinder("plaza:fountain-lower-bowl", { diameter: 5.35, height: 0.42, tessellation: 48 }, scene);
  lowerBowl.position = new Vector3(fountain.x, 0.38, fountain.z);
  finish(lowerBowl, skins.stoneLight);
  const lowerRim = CreateTorus("plaza:fountain-lower-rim", { diameter: 5.35, thickness: 0.16, tessellation: 48 }, scene);
  lowerRim.position = new Vector3(fountain.x, 0.62, fountain.z);
  finish(lowerRim, skins.stone);
  const lowerWater = CreateCylinder("plaza:fountain-water-lower", { diameter: 4.92, height: 0.08, tessellation: 48 }, scene);
  lowerWater.position = new Vector3(fountain.x, 0.62, fountain.z);
  finish(lowerWater, skins.water);
  const pedestal = CreateCylinder("plaza:fountain-pedestal", { diameter: 1.10, height: 1.18, tessellation: 24 }, scene);
  pedestal.position = new Vector3(fountain.x, 1.18, fountain.z);
  finish(pedestal, skins.stoneLight);
  const upperBowl = CreateCylinder("plaza:fountain-upper-bowl", { diameter: 2.68, height: 0.24, tessellation: 32 }, scene);
  upperBowl.position = new Vector3(fountain.x, 1.84, fountain.z);
  finish(upperBowl, skins.stoneLight);
  const upperRim = CreateTorus("plaza:fountain-upper-rim", { diameter: 2.68, thickness: 0.11, tessellation: 32 }, scene);
  upperRim.position = new Vector3(fountain.x, 1.98, fountain.z);
  finish(upperRim, skins.stone);
  const upperWater = CreateCylinder("plaza:fountain-water-upper", { diameter: 2.28, height: 0.06, tessellation: 32 }, scene);
  upperWater.position = new Vector3(fountain.x, 1.99, fountain.z);
  finish(upperWater, skins.water);
  const finial = CreateCylinder("plaza:fountain-finial", { diameterTop: 0.16, diameterBottom: 0.42, height: 0.55, tessellation: 16 }, scene);
  finial.position = new Vector3(fountain.x, 2.36, fountain.z);
  finish(finial, skins.stoneLight);
}

function mergeOpaquePlazaMeshes(scene: Scene, before: ReadonlySet<AbstractMesh>): void {
  const byMaterial = new Map<number, Mesh[]>();
  for (const mesh of [...scene.meshes]) {
    if (!(mesh instanceof Mesh) || before.has(mesh) || mesh.name.includes("fountain-water") || !mesh.material) continue;
    const key = mesh.material.uniqueId * 2 + (mesh.metadata?.castShadow === false ? 0 : 1);
    const sameMaterial = byMaterial.get(key) ?? [];
    sameMaterial.push(mesh);
    byMaterial.set(key, sameMaterial);
  }
  for (const meshes of byMaterial.values()) {
    if (meshes.length < 2) continue;
    const skin = meshes[0]?.material;
    if (!(skin instanceof StandardMaterial)) continue;
    const castShadow = meshes[0]?.metadata?.castShadow !== false;
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) continue;
    finish(merged, skin, castShadow);
  }
}

/** Build the detailed Mediterranean coastal social plaza. */
export function buildPlaza(scene: Scene, radius: number): void {
  const before = new Set(scene.meshes);
  const skins = palette(scene);
  buildPavement(scene, radius, skins);
  for (const building of PLAZA_BUILDINGS) buildBuilding(scene, building, skins);
  for (const planter of PLAZA_PLANTERS) buildPlanter(scene, planter, skins);
  for (const bench of PLAZA_BENCHES) buildBench(scene, bench, skins);
  for (const cafe of PLAZA_CAFE_POCKETS) buildCafePocket(scene, cafe, skins);
  buildFountain(scene, skins);

  mergeOpaquePlazaMeshes(scene, before);

  // All transforms are final before freezing. The ground is a receiver only.
  for (const mesh of scene.meshes) {
    if (before.has(mesh)) continue;
    mesh.computeWorldMatrix(true);
    if (mesh.name.includes("fountain-water")) continue;
    mesh.freezeWorldMatrix();
  }
}
