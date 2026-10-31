import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

type Palette = {
  deck: StandardMaterial;
  deckLight: StandardMaterial;
  concrete: StandardMaterial;
  concreteLight: StandardMaterial;
  concreteWarm: StandardMaterial;
  concreteDark: StandardMaterial;
  glass: StandardMaterial;
  glassBlue: StandardMaterial;
  trim: StandardMaterial;
  roof: StandardMaterial;
  road: StandardMaterial;
  lane: StandardMaterial;
  rail: StandardMaterial;
  car: StandardMaterial;
  carAlt: StandardMaterial;
  carGlass: StandardMaterial;
  palm: StandardMaterial;
  palmLeaf: StandardMaterial;
};

type TowerStyle = "residential" | "office" | "hotel" | "marina";

type TowerSpec = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  floors: number;
  style: TowerStyle;
  facade: "concrete" | "light" | "warm" | "dark";
};

const TOWERS: readonly TowerSpec[] = [
  { id: "harbor-gate", x: -105, z: 98, width: 17, depth: 12, height: 36, floors: 11, style: "hotel", facade: "warm" },
  { id: "residence-a", x: -80, z: 91, width: 13, depth: 10, height: 27, floors: 8, style: "residential", facade: "light" },
  { id: "civic-slab", x: -56, z: 99, width: 15, depth: 12, height: 49, floors: 15, style: "office", facade: "concrete" },
  { id: "marina-court", x: -31, z: 90, width: 13, depth: 10, height: 23, floors: 7, style: "marina", facade: "warm" },
  { id: "glass-needle-south", x: -3, z: 96, width: 17, depth: 13, height: 41, floors: 12, style: "office", facade: "dark" },
  { id: "residence-b", x: 28, z: 91, width: 12, depth: 10, height: 30, floors: 9, style: "residential", facade: "light" },
  { id: "bluewater-hotel", x: 53, z: 100, width: 16, depth: 12, height: 53, floors: 16, style: "hotel", facade: "warm" },
  { id: "marina-house", x: 78, z: 92, width: 14, depth: 11, height: 31, floors: 9, style: "marina", facade: "concrete" },
  { id: "east-terrace", x: 106, z: 103, width: 18, depth: 13, height: 45, floors: 13, style: "residential", facade: "light" },
  { id: "west-vertical", x: -111, z: 132, width: 19, depth: 14, height: 59, floors: 18, style: "office", facade: "dark" },
  { id: "west-highrise", x: -82, z: 128, width: 15, depth: 12, height: 77, floors: 23, style: "residential", facade: "concrete" },
  { id: "northwest-block", x: -51, z: 131, width: 13, depth: 12, height: 39, floors: 12, style: "marina", facade: "warm" },
  { id: "central-skyline", x: -20, z: 126, width: 17, depth: 13, height: 63, floors: 19, style: "office", facade: "concrete" },
  { id: "central-east", x: 14, z: 132, width: 13, depth: 11, height: 47, floors: 14, style: "hotel", facade: "light" },
  { id: "forum-tower", x: 44, z: 123, width: 20, depth: 14, height: 69, floors: 21, style: "office", facade: "dark" },
  { id: "east-highrise", x: 76, z: 131, width: 16, depth: 12, height: 54, floors: 16, style: "residential", facade: "concrete" },
  { id: "east-vertical", x: 108, z: 138, width: 19, depth: 13, height: 74, floors: 22, style: "hotel", facade: "warm" },
  { id: "back-west-gate", x: -108, z: 171, width: 21, depth: 16, height: 51, floors: 15, style: "marina", facade: "light" },
  { id: "back-west-tower", x: -72, z: 166, width: 17, depth: 14, height: 67, floors: 20, style: "office", facade: "concrete" },
  { id: "back-harbor-block", x: -37, z: 174, width: 24, depth: 16, height: 56, floors: 17, style: "residential", facade: "warm" },
  { id: "back-central-tower", x: 2, z: 168, width: 19, depth: 14, height: 80, floors: 24, style: "office", facade: "dark" },
  { id: "back-east-block", x: 38, z: 175, width: 21, depth: 15, height: 62, floors: 19, style: "hotel", facade: "light" },
  { id: "back-east-tower", x: 73, z: 169, width: 17, depth: 14, height: 87, floors: 26, style: "office", facade: "concrete" },
  { id: "far-east-gate", x: 108, z: 177, width: 22, depth: 15, height: 60, floors: 18, style: "residential", facade: "warm" }
];

function makeMaterial(scene: Scene, name: string, color: Color3, roughness = 0.78): StandardMaterial {
  const made = new StandardMaterial(`skyline:${name}`, scene);
  made.diffuseColor = color;
  made.specularColor = new Color3(0.035, 0.04, 0.045);
  made.roughness = roughness;
  if (name.includes("glass")) {
    made.emissiveColor.set(0.065, 0.105, 0.12);
    made.specularColor.set(0.5, 0.55, 0.6);
    made.specularPower = 96;
  }
  return made;
}

function palette(scene: Scene): Palette {
  return {
    deck: makeMaterial(scene, "deck", new Color3(0.24, 0.27, 0.28)),
    deckLight: makeMaterial(scene, "deck-light", new Color3(0.37, 0.39, 0.38)),
    concrete: makeMaterial(scene, "concrete", new Color3(0.47, 0.49, 0.48)),
    concreteLight: makeMaterial(scene, "concrete-light", new Color3(0.64, 0.64, 0.60)),
    concreteWarm: makeMaterial(scene, "concrete-warm", new Color3(0.59, 0.53, 0.45)),
    concreteDark: makeMaterial(scene, "concrete-dark", new Color3(0.27, 0.29, 0.30)),
    glass: makeMaterial(scene, "glass", new Color3(0.12, 0.25, 0.29), 0.3),
    glassBlue: makeMaterial(scene, "glass-blue", new Color3(0.16, 0.36, 0.42), 0.28),
    trim: makeMaterial(scene, "trim", new Color3(0.72, 0.70, 0.64)),
    roof: makeMaterial(scene, "roof", new Color3(0.19, 0.22, 0.23)),
    road: makeMaterial(scene, "road", new Color3(0.12, 0.14, 0.15)),
    lane: makeMaterial(scene, "lane", new Color3(0.67, 0.60, 0.43)),
    rail: makeMaterial(scene, "rail", new Color3(0.23, 0.29, 0.29)),
    car: makeMaterial(scene, "car", new Color3(0.33, 0.38, 0.39)),
    carAlt: makeMaterial(scene, "car-alt", new Color3(0.49, 0.35, 0.27)),
    carGlass: makeMaterial(scene, "car-glass", new Color3(0.09, 0.18, 0.21), 0.24),
    palm: makeMaterial(scene, "palm-trunk", new Color3(0.36, 0.28, 0.17)),
    palmLeaf: makeMaterial(scene, "palm-leaf", new Color3(0.23, 0.34, 0.24))
  };
}

function finish(mesh: Mesh, skin: StandardMaterial, castShadow = true): Mesh {
  mesh.material = skin;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  mesh.metadata = { ...(mesh.metadata ?? {}), castShadow };
  return mesh;
}

function box(
  scene: Scene,
  name: string,
  width: number,
  depth: number,
  height: number,
  x: number,
  centerY: number,
  z: number,
  skin: StandardMaterial,
  castShadow = true,
  rotationY = 0
): Mesh {
  const made = CreateBox(`skyline:${name}`, { width, depth, height }, scene);
  made.position = new Vector3(x, centerY, z);
  made.rotation.y = rotationY;
  return finish(made, skin, castShadow);
}

function cylinder(
  scene: Scene,
  name: string,
  diameter: number,
  height: number,
  x: number,
  centerY: number,
  z: number,
  skin: StandardMaterial,
  castShadow = true
): Mesh {
  const made = CreateCylinder(`skyline:${name}`, { diameter, height, tessellation: 12 }, scene);
  made.position = new Vector3(x, centerY, z);
  return finish(made, skin, castShadow);
}

function cylinderBetween(scene: Scene, name: string, start: Vector3, end: Vector3, diameter: number, skin: StandardMaterial): Mesh {
  const direction = end.subtract(start);
  const made = CreateCylinder(`skyline:${name}`, { diameter, height: direction.length(), tessellation: 8 }, scene);
  made.position = start.add(end).scale(0.5);
  made.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), new Quaternion());
  return finish(made, skin);
}

function facadeSkin(spec: TowerSpec, skins: Palette): StandardMaterial {
  if (spec.facade === "light") return skins.concreteLight;
  if (spec.facade === "warm") return skins.concreteWarm;
  if (spec.facade === "dark") return skins.concreteDark;
  return skins.concrete;
}

function buildTower(scene: Scene, spec: TowerSpec, skins: Palette): void {
  const bodySkin = facadeSkin(spec, skins);
  const podiumHeight = 2.4;
  box(scene, `${spec.id}-podium`, spec.width + 2.8, spec.depth + 2.4, podiumHeight, spec.x, podiumHeight / 2, spec.z, skins.concreteDark);
  box(scene, `${spec.id}-body`, spec.width, spec.depth, spec.height, spec.x, podiumHeight + spec.height / 2, spec.z, bodySkin);
  box(scene, `${spec.id}-plinth`, spec.width + 0.35, spec.depth + 0.35, 0.22, spec.x, podiumHeight + 0.11, spec.z, skins.trim);

  const floorSpacing = Math.max(2.65, spec.height / Math.max(1, spec.floors));
  const front = spec.z - spec.depth / 2 - 0.075;
  const windowSkin = spec.style === "office" || spec.style === "marina" ? skins.glass : skins.glassBlue;
  const bands = Math.min(12, Math.max(4, Math.ceil(spec.height / 5.5)));
  for (let band = 0; band < bands; band += 1) {
    const y = podiumHeight + 1.05 + band * (spec.height - 2.3) / bands;
    const inset = spec.style === "office" ? 0.82 : 0.70;
    box(scene, `${spec.id}-window-band-${band}`, spec.width * inset, 0.08, 0.78, spec.x, y, front, windowSkin, false);
    if (band % 2 === 0) {
      const mullions = Math.max(2, Math.floor(spec.width / 3.4));
      for (let mullion = 0; mullion < mullions; mullion += 1) {
        const localX = (mullion - (mullions - 1) / 2) * (spec.width * inset / Math.max(1, mullions - 1));
        box(scene, `${spec.id}-mullion-${band}-${mullion}`, 0.07, 0.10, 0.90, spec.x + localX, y, front - 0.03, skins.trim, false);
      }
    }
  }

  // Vertical fins keep the repeated window bands from reading as a bare box.
  for (const side of [-1, 1]) {
    box(scene, `${spec.id}-vertical-fin-${side}`, 0.18, 0.22, spec.height - 0.35,
      spec.x + side * (spec.width / 2 - 0.28), podiumHeight + spec.height / 2, front - 0.06, skins.trim);
  }
  for (const side of [-1, 1]) {
    box(scene, `${spec.id}-side-fin-${side}`, 0.12, spec.depth * 0.72, spec.height - 0.6,
      spec.x + side * (spec.width / 2 - 0.20), podiumHeight + spec.height / 2, spec.z, skins.concreteDark);
  }

  if (spec.style === "residential" || spec.style === "hotel" || spec.style === "marina") {
    const balconies = Math.max(2, Math.min(8, Math.floor(spec.floors / 3)));
    for (let balcony = 0; balcony < balconies; balcony += 1) {
      const y = podiumHeight + 3.0 + balcony * floorSpacing * 3;
      if (y > podiumHeight + spec.height - 1.4) break;
      const width = spec.width * (spec.style === "marina" ? 0.72 : 0.60);
      const depth = 1.35;
      const centreZ = front - depth / 2 + 0.04;
      box(scene, `${spec.id}-balcony-slab-${balcony}`, width, depth, 0.16, spec.x, y, centreZ, skins.trim);
      box(scene, `${spec.id}-balcony-front-rail-${balcony}`, width, 0.08, 0.08, spec.x, y + 0.77, front - depth + 0.08, skins.rail);
      for (const side of [-1, 1]) {
        box(scene, `${spec.id}-balcony-post-${balcony}-${side}`, 0.07, 0.07, 0.82,
          spec.x + side * (width / 2 - 0.08), y + 0.40, front - depth + 0.08, skins.rail);
      }
      if (spec.style === "marina") {
        box(scene, `${spec.id}-balcony-divider-${balcony}`, 0.08, depth, 0.76, spec.x, y + 0.38, centreZ, skins.rail);
      }
    }
  }

  if (spec.style === "office") {
    const coreWidth = Math.min(3.2, spec.width * 0.24);
    box(scene, `${spec.id}-glass-core`, coreWidth, 0.10, spec.height - 1.0, spec.x, podiumHeight + spec.height / 2, front - 0.10, skins.glassBlue, false);
    for (const side of [-1, 1]) {
      box(scene, `${spec.id}-office-wing-${side}`, spec.width * 0.18, 0.13, spec.height - 2.0,
        spec.x + side * spec.width * 0.30, podiumHeight + spec.height / 2, front - 0.10, skins.glass, false);
    }
  }

  // A roof plant and antenna give each tall block a believable service silhouette.
  box(scene, `${spec.id}-roof-plate`, spec.width + 0.12, spec.depth + 0.12, 0.22,
    spec.x, podiumHeight + spec.height + 0.11, spec.z, skins.roof);
  if (spec.height > 32) {
    const plantWidth = Math.max(2.2, spec.width * 0.30);
    box(scene, `${spec.id}-roof-service`, plantWidth, spec.depth * 0.32, 1.45,
      spec.x - spec.width * 0.18, podiumHeight + spec.height + 0.85, spec.z, skins.concreteDark);
    cylinder(scene, `${spec.id}-water-tank`, Math.min(2.4, spec.width * 0.18), 1.8,
      spec.x + spec.width * 0.20, podiumHeight + spec.height + 1.0, spec.z + spec.depth * 0.12, skins.roof);
    cylinderBetween(scene, `${spec.id}-antenna`, new Vector3(spec.x, podiumHeight + spec.height + 1.5, spec.z),
      new Vector3(spec.x, podiumHeight + spec.height + (spec.height > 60 ? 6.5 : 4.0), spec.z), 0.08, skins.rail);
    box(scene, `${spec.id}-antenna-crossbar`, Math.min(2.5, spec.width * 0.20), 0.08, 0.08,
      spec.x, podiumHeight + spec.height + (spec.height > 60 ? 5.1 : 3.0), spec.z, skins.rail);
  } else {
    box(scene, `${spec.id}-roof-house`, spec.width * 0.28, spec.depth * 0.28, 1.0,
      spec.x + spec.width * 0.16, podiumHeight + spec.height + 0.60, spec.z, skins.concreteDark);
  }
}

function buildCityDeck(scene: Scene, skins: Palette): void {
  // z=70 is the nearest edge, keeping every skyline surface outside the 65m play ring.
  box(scene, "city-deck", 270, 132, 0.48, 0, -0.24, 136, skins.deck, false);
  for (const x of [-120, -60, 0, 60, 120]) {
    for (const z of [76, 112, 150, 190]) {
      cylinder(scene, `deck-pier-${x}-${z}`, 1.25, 2.45, x, -1.22, z, skins.concreteDark);
    }
  }
  // A second, slightly raised slab makes the deck read as a connected waterfront district.
  box(scene, "city-terrace-strip", 250, 7.5, 0.22, 0, 0.11, 87, skins.deckLight, false);
  box(scene, "coastal-highway", 250, 6.5, 0.26, 0, 0.24, 76.5, skins.road, false);
  for (let x = -112; x <= 112; x += 14) {
    box(scene, `highway-dash-${x}`, 6.5, 0.12, 0.025, x, 0.39, 76.5, skins.lane, false);
  }
  box(scene, "promenade", 235, 4.2, 0.18, 0, 0.35, 83.4, skins.deckLight, false);
  box(scene, "promenade-seawall", 235, 0.34, 1.05, 0, 0.86, 85.25, skins.concreteDark, false);
  for (let x = -114; x <= 114; x += 12) {
    cylinder(scene, `promenade-rail-post-${x}`, 0.08, 1.15, x, 1.00, 84.9, skins.rail, false);
  }
  box(scene, "promenade-rail-top", 235, 0.08, 0.08, 0, 1.55, 84.9, skins.rail, false);
}

function buildCars(scene: Scene, skins: Palette): void {
  for (let index = 0; index < 18; index += 1) {
    const x = -108 + index * 12.7;
    const z = 76.5 + (index % 2 === 0 ? -1.45 : 1.45);
    const bodySkin = index % 4 === 0 ? skins.carAlt : skins.car;
    box(scene, `parked-car-${index}-body`, 4.5, 1.92, 0.62, x, 0.83, z, bodySkin);
    box(scene, `parked-car-${index}-cab`, 2.55, 1.48, 0.48, x - 0.15, 1.36, z, skins.carGlass, false);
    box(scene, `parked-car-${index}-bumper`, 0.18, 1.76, 0.18, x + 2.17, 0.78, z, skins.trim, false);
  }
}

function buildPalm(scene: Scene, skins: Palette, index: number, x: number, z: number): void {
  cylinder(scene, `palm-${index}-trunk`, 0.48, 8.2, x, 4.10, z, skins.palm);
  const crown = new Vector3(x, 8.35, z);
  for (let frond = 0; frond < 8; frond += 1) {
    const angle = frond * Math.PI / 4 + index * 0.25;
    const length = 2.4 + (frond % 3) * 0.35;
    const end = new Vector3(x + Math.cos(angle) * length, 7.80 - (frond % 2) * 0.24, z + Math.sin(angle) * length);
    cylinderBetween(scene, `palm-${index}-frond-${frond}`, crown, end, 0.15, skins.palmLeaf);
  }
  const crownMesh = CreateSphere(`skyline:palm-${index}-crown`, { diameter: 0.70, segments: 8 }, scene);
  crownMesh.position.copyFrom(crown);
  finish(crownMesh, skins.palmLeaf);
}

function mergeStaticMeshes(scene: Scene, before: ReadonlySet<AbstractMesh>): void {
  const groups = new Map<string, Mesh[]>();
  for (const candidate of [...scene.meshes]) {
    if (!(candidate instanceof Mesh) || before.has(candidate) || !candidate.material) continue;
    const cast = candidate.metadata?.castShadow === false ? "0" : "1";
    const key = `${candidate.material.uniqueId}:${cast}`;
    const meshes = groups.get(key) ?? [];
    meshes.push(candidate);
    groups.set(key, meshes);
  }
  for (const [key, meshes] of groups) {
    if (meshes.length < 2) continue;
    const material = meshes[0]?.material;
    if (!(material instanceof StandardMaterial)) continue;
    const castShadow = meshes[0]?.metadata?.castShadow !== false;
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = `skyline:merged-${key}`;
    finish(merged, material, castShadow);
  }
}

/** Build a real-scale procedural coastal city visible beyond the playable shore. */
export function buildSkyline(scene: Scene): void {
  const before = new Set(scene.meshes);
  const skins = palette(scene);
  buildCityDeck(scene, skins);
  for (const tower of TOWERS) buildTower(scene, { ...tower, height: tower.height * 0.72,
    floors: Math.max(5, Math.round(tower.floors * 0.72)) }, skins);
  buildCars(scene, skins);
  for (const [index, x] of [-108, -78, -48, 46, 78, 108].entries()) buildPalm(scene, skins, index, x, 73.5);
  mergeStaticMeshes(scene, before);
  for (const mesh of scene.meshes) {
    if (before.has(mesh)) continue;
    // Put the skyline across the water so it reads as a distant district,
    // leaving sky above the human-scale street instead of a wall of towers.
    mesh.position.z += 115;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }
}
