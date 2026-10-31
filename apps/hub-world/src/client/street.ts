import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

import { streetMaterial } from "./surfaces";
import {
  STREET_BENCHES,
  STREET_BUILDINGS,
  STREET_PALMS,
  type StreetBench,
  type StreetBuilding,
  type StreetPalm,
  type StreetSolid
} from "../world/street";

type SurfaceKind = "concrete" | "stucco" | "stone" | "asphalt" | "wood" | "metal" | "glass" | "leaf" | "bark" | "paint" | "terracotta";
type Palette = Record<SurfaceKind, PBRMaterial>;

function palette(scene: Scene): Palette {
  const kinds: SurfaceKind[] = ["concrete", "stucco", "stone", "asphalt", "wood", "metal", "glass", "leaf", "bark", "paint", "terracotta"];
  return Object.fromEntries(kinds.map((kind) => [kind, streetMaterial(scene, kind)])) as Palette;
}

function finish(mesh: Mesh, material: PBRMaterial, castShadow = true): Mesh {
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = material.name.includes(":glass") ? false : true;
  const metadata = mesh.metadata && typeof mesh.metadata === "object" ? mesh.metadata : {};
  mesh.metadata = { ...metadata, castShadow };
  return mesh;
}

/** Babylon primitives default to a single 0..1 UV span. Scale it by the
 * authored metre dimensions so the supplied surface maps repeat at street
 * scale instead of stretching across a whole block. */
function tileUv(mesh: Mesh, uScale: number, vScale: number): void {
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!uv) return;
  for (let index = 0; index < uv.length; index += 2) {
    uv[index] = (uv[index] ?? 0) * uScale;
    uv[index + 1] = (uv[index + 1] ?? 0) * vScale;
  }
  mesh.updateVerticesData(VertexBuffer.UVKind, uv, false, false);
}

function boxWorld(scene: Scene, name: string, width: number, depth: number, height: number, x: number, y: number, z: number, material: PBRMaterial, rotationY = 0, castShadow = true): Mesh {
  const mesh = CreateBox(`street:${name}`, { width, depth, height }, scene);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  tileUv(mesh, Math.max(1, width), Math.max(1, depth));
  return finish(mesh, material, castShadow);
}

function boxLocal(scene: Scene, name: string, width: number, depth: number, height: number, solid: StreetSolid, localX: number, localZ: number, baseY: number, material: PBRMaterial, rotationY = solid.turn ?? 0, castShadow = true): Mesh {
  const turn = solid.turn ?? 0;
  const c = Math.cos(turn), s = Math.sin(turn);
  const mesh = CreateBox(`street:${name}`, { width, depth, height }, scene);
  mesh.position.set(solid.x + localX * c - localZ * s, baseY + height / 2, solid.z + localX * s + localZ * c);
  mesh.rotation.y = rotationY;
  tileUv(mesh, Math.max(1, width), Math.max(1, depth));
  return finish(mesh, material, castShadow);
}

function cylinderBetween(scene: Scene, name: string, start: Vector3, end: Vector3, diameter: number, material: PBRMaterial, tessellation = 12, castShadow = true): Mesh {
  const direction = end.subtract(start);
  const mesh = CreateCylinder(`street:${name}`, { diameter, height: direction.length(), tessellation }, scene);
  mesh.position = start.add(end).scale(0.5);
  mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), new Quaternion());
  return finish(mesh, material, castShadow);
}

function facadeBox(scene: Scene, name: string, building: StreetBuilding, z: number, widthZ: number, height: number, bottomY: number, depthX: number, material: PBRMaterial, offset = 0, castShadow = true): Mesh {
  const side = building.side === "west" ? 1 : -1;
  const x = building.x + side * (building.width / 2 + offset);
  return boxWorld(scene, name, depthX, widthZ, height, x, bottomY + height / 2, building.z + z, material, 0, castShadow);
}

function addWindow(scene: Scene, building: StreetBuilding, p: Palette, name: string, z: number, bottomY: number, widthZ: number, height: number, awning: boolean): void {
  const side = building.side === "west" ? 1 : -1;
  // The stone surround and sill project around a darker recess, making the
  // otherwise solid wall read as a room with depth from the street.
  facadeBox(scene, `${name}-recess`, building, z, widthZ, height, bottomY, 0.10, p.stone, -0.025, false);
  facadeBox(scene, `${name}-glass`, building, z, widthZ - 0.28, height - 0.30, bottomY + 0.15, 0.035, p.glass, 0.035, false);
  facadeBox(scene, `${name}-sill`, building, z, widthZ + 0.26, 0.14, bottomY - 0.12, 0.22, p.concrete, 0.12);
  facadeBox(scene, `${name}-header`, building, z, widthZ + 0.26, 0.14, bottomY + height + 0.06, 0.20, p.concrete, 0.12);
  facadeBox(scene, `${name}-jamb-a`, building, z - widthZ / 2, 0.14, height + 0.16, bottomY - 0.02, 0.18, p.concrete, 0.11);
  facadeBox(scene, `${name}-jamb-b`, building, z + widthZ / 2, 0.14, height + 0.16, bottomY - 0.02, 0.18, p.concrete, 0.11);
  if (awning) {
    const sideX = building.x + side * (building.width / 2 + 0.52);
    boxWorld(scene, `${name}-awning`, 0.85, widthZ + 0.34, 0.16, sideX, bottomY + height + 0.38, building.z + z, p.terracotta, 0, true);
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      boxWorld(scene, `${name}-awning-stripe-${stripe}`, 0.88, 0.10, 0.025, sideX + side * 0.02, bottomY + height + 0.28, building.z + z + stripe * (widthZ / 5), p.paint, 0, false);
    }
  }
}

function addBalcony(scene: Scene, building: StreetBuilding, p: Palette, name: string, z: number, floorY: number, widthZ: number): void {
  const side = building.side === "west" ? 1 : -1;
  const frontX = building.x + side * (building.width / 2 + 0.70);
  boxWorld(scene, `${name}-slab`, 1.18, widthZ, 0.20, frontX - side * 0.26, floorY, building.z + z, p.stone);
  // Glass infill is separate from opaque rails and is left unmerged.
  boxWorld(scene, `${name}-glass`, 0.055, widthZ - 0.20, 0.72, frontX, floorY + 0.48, building.z + z, p.glass, 0, false);
  boxWorld(scene, `${name}-top-rail`, 0.10, widthZ + 0.12, 0.10, frontX + side * 0.04, floorY + 0.90, building.z + z, p.metal);
  for (const railZ of [-widthZ / 2, -widthZ / 4, 0, widthZ / 4, widthZ / 2]) {
    boxWorld(scene, `${name}-rail-${railZ}`, 0.09, 0.09, 0.92, frontX + side * 0.04, floorY + 0.43, building.z + z + railZ, p.metal);
  }
  for (const railZ of [-widthZ / 2, widthZ / 2]) {
    boxWorld(scene, `${name}-side-rail-${railZ}`, 0.90, 0.09, 0.09, frontX - side * 0.38, floorY + 0.90, building.z + z + railZ, p.metal);
  }
}

function addSign(scene: Scene, building: StreetBuilding, p: Palette, z: number, labelIndex: number): void {
  const side = building.side === "west" ? 1 : -1;
  const x = building.x + side * (building.width / 2 + 0.69);
  facadeBox(scene, `sign-${building.id}-${labelIndex}`, building, z, 1.70, 0.62, 2.72, 0.12, p.paint, 0.16);
  // Three raised bars provide a readable Art Deco sign silhouette without
  // allocating a separate material or a dynamic texture per storefront.
  for (let bar = -1; bar <= 1; bar += 1) {
    boxWorld(scene, `sign-${building.id}-${labelIndex}-bar-${bar}`, 0.08, 1.05, 0.05, x + side * 0.08, 2.72 + bar * 0.15, building.z + z, p.metal, 0, false);
  }
}

function addRoof(scene: Scene, building: StreetBuilding, p: Palette): void {
  boxWorld(scene, `${building.id}-roof-deck`, building.width + 0.24, building.depth + 0.24, 0.24, building.x, building.height + 0.12, building.z, p.concrete);
  const parapetY = building.height + 0.43;
  boxWorld(scene, `${building.id}-parapet-inner`, 0.20, building.depth + 0.10, 0.52, building.x + (building.side === "west" ? building.width / 2 - 0.10 : -building.width / 2 + 0.10), parapetY, building.z, p.stucco);
  boxWorld(scene, `${building.id}-parapet-end-a`, building.width + 0.08, 0.20, 0.52, building.x, parapetY, building.z - building.depth / 2 + 0.10, p.stucco);
  boxWorld(scene, `${building.id}-parapet-end-b`, building.width + 0.08, 0.20, 0.52, building.x, parapetY, building.z + building.depth / 2 - 0.10, p.stucco);
  // Rooftop service ducts add a practical silhouette to the skyline.
  const ductX = building.x + (building.side === "west" ? -2.9 : 2.9);
  for (const z of [-building.depth * 0.28, building.depth * 0.22]) {
    const duct = CreateCylinder(`street:${building.id}-roof-duct-${z}`, { diameter: 0.48, height: 1.18, tessellation: 16 }, scene);
    duct.position.set(ductX, building.height + 1.02, building.z + z);
    finish(duct, p.metal);
    boxWorld(scene, `${building.id}-duct-cap-${z}`, 0.66, 0.66, 0.10, ductX, building.height + 1.64, building.z + z, p.metal);
  }
}

function buildBuilding(scene: Scene, building: StreetBuilding, p: Palette): void {
  const wall = boxWorld(scene, building.id, building.width, building.depth, building.height, building.x, building.height / 2, building.z, building.facade === "stucco" ? p.stucco : p.concrete);
  wall.metadata = { ...wall.metadata, streetWall: true };
  boxWorld(scene, `${building.id}-plinth`, building.width + 0.24, building.depth + 0.18, 0.36, building.x, 0.18, building.z, p.stone);
  boxWorld(scene, `${building.id}-cornice`, building.width + 0.30, building.depth + 0.18, 0.26, building.x, building.height - 0.13, building.z, p.paint);
  addRoof(scene, building, p);

  const windowZ = [-11.0, -5.6, 0, 5.6, 11.0];
  for (const [index, z] of windowZ.entries()) addWindow(scene, building, p, `${building.id}-shop-${index}`, z, 0.78, 3.65, 2.14, true);
  const floors = building.floors === 3 ? [3.72, 6.52, 9.00] : [4.10, 7.05];
  for (const [floor, y] of floors.entries()) {
    for (const z of [-8.6, -2.9, 2.9, 8.6]) addWindow(scene, building, p, `${building.id}-upper-${floor}-${z}`, z, y, 3.12, 1.72, false);
    if (floor === 0) addBalcony(scene, building, p, `${building.id}-balcony`, building.side === "west" ? -5.2 : 5.2, y - 0.12, 4.25);
  }
  addSign(scene, building, p, building.side === "west" ? -5.6 : 5.6, 0);
  addSign(scene, building, p, building.side === "west" ? 5.6 : -5.6, 1);
  // Vertical fins and shallow pilasters express the Art Deco rhythm.
  for (const z of [-14.0, -7.0, 0, 7.0, 14.0]) {
    facadeBox(scene, `${building.id}-fin-${z}`, building, z, 0.18, building.height - 0.62, 0.30, 0.28, p.paint, 0.16);
  }
}

function buildBench(scene: Scene, bench: StreetBench, p: Palette): void {
  for (let slat = -2; slat <= 2; slat += 1) boxLocal(scene, `${bench.id}-seat-${slat}`, bench.width * 0.86, 0.12, 0.08, bench, 0, slat * 0.14, 0.43, p.wood);
  for (const x of [-bench.width * 0.32, bench.width * 0.32]) {
    boxLocal(scene, `${bench.id}-leg-${x}`, 0.16, 0.48, 0.43, bench, x, 0, 0.02, p.metal);
    boxLocal(scene, `${bench.id}-foot-${x}`, 0.42, 0.10, 0.08, bench, x, 0, 0, p.metal);
  }
  for (let slat = 0; slat < 3; slat += 1) boxLocal(scene, `${bench.id}-back-${slat}`, bench.width * 0.86, 0.10, 0.12, bench, 0, 0.28, 0.62 + slat * 0.16, p.wood);
}

function palmLeaf(scene: Scene, name: string, center: Vector3, direction: Vector3, length: number, p: Palette): Mesh {
  const side = Vector3.Cross(direction, Vector3.Up()).normalize().scale(0.065);
  const tip = center.add(direction.normalize().scale(length));
  const droop = new Vector3(0, -0.20, 0);
  const positions = [
    center.subtract(side).asArray(), center.add(side).asArray(),
    tip.add(droop).add(side.scale(0.035)).asArray(), tip.add(droop).subtract(side.scale(0.035)).asArray()
  ].flat();
  const indices = [0, 1, 2, 0, 2, 3];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs: [0, 0, 1, 0, 1, 1, 0, 1] });
  const leaf = new Mesh(`street:${name}`, scene);
  data.applyToMesh(leaf);
  return finish(leaf, p.leaf, true);
}

function buildPalm(scene: Scene, palm: StreetPalm, p: Palette): void {
  const base = new Vector3(palm.x, 0.76, palm.z);
  const crown = new Vector3(palm.x + 0.16, 7.15, palm.z);
  cylinderBetween(scene, `${palm.id}-trunk-lower`, base, new Vector3(palm.x - 0.12, 4.10, palm.z + 0.02), 0.36, p.bark, 12);
  cylinderBetween(scene, `${palm.id}-trunk-upper`, new Vector3(palm.x - 0.12, 4.05, palm.z + 0.02), crown, 0.24, p.bark, 12);
  for (let frond = 0; frond < 14; frond += 1) {
    const angle = frond * (Math.PI * 2 / 14) + 0.18;
    const direction = new Vector3(Math.cos(angle) * 0.86, -0.18 + (frond % 3) * 0.025, Math.sin(angle) * 0.86);
    palmLeaf(scene, `${palm.id}-frond-${frond}`, crown, direction, 2.25 + (frond % 4) * 0.18, p);
  }
  // A low stone collar is the only ground-level circular solid and is already
  // represented by the matching shared palm footprint.
  const collar = CreateCylinder(`street:${palm.id}-collar`, { diameter: palm.radius * 2, height: 0.18, tessellation: 24 }, scene);
  collar.position.set(palm.x, 0.09, palm.z);
  finish(collar, p.stone);
}

function buildSurface(scene: Scene, radius: number, p: Palette): void {
  const extent = Math.max(radius, 45);
  const ground = CreateGround("street:sidewalk-ground", { width: extent * 2, height: extent * 2, subdivisions: 4 }, scene);
  ground.position.y = -0.04;
  tileUv(ground, extent * 2, extent * 2);
  finish(ground, p.concrete, false);
  boxWorld(scene, "street:asphalt-road", 8, extent * 2, 0.08, 0, 0, 0, p.asphalt, 0, false);
  boxWorld(scene, "street:west-sidewalk", 6.4, extent * 2, 0.10, -7.2, 0.01, 0, p.stone, 0, false);
  boxWorld(scene, "street:east-sidewalk", 6.4, extent * 2, 0.10, 7.2, 0.01, 0, p.stone, 0, false);
  // Eight broad paint bars form the raised crossing at z=6 without adding a
  // collision footprint to the open road.
  for (let stripe = -3; stripe <= 3; stripe += 1) boxWorld(scene, `street:crossing-${stripe}`, 0.34, 3.0, 0.025, stripe * 1.08, 0.075, 6, p.paint, 0, false);
  for (const z of [-12, 6, 24]) {
    for (const x of [-3.15, 3.15]) boxWorld(scene, `street:drain-${x}-${z}`, 0.24, 1.12, 0.028, x, 0.075, z, p.metal, 0, false);
  }
  // The square is distinguished by a quiet stone border, while its centre
  // stays open for social movement and the north/south route.
  boxWorld(scene, "street:square-border-west", 0.18, 12.4, 0.11, -11.0, 0.04, 14.0, p.terracotta, 0, false);
  boxWorld(scene, "street:square-border-east", 0.18, 12.4, 0.11, 11.0, 0.04, 14.0, p.terracotta, 0, false);
}

function mergeOpaqueStreetMeshes(scene: Scene, before: ReadonlySet<AbstractMesh>): void {
  const grouped = new Map<string, Mesh[]>();
  for (const mesh of [...scene.meshes]) {
    if (!(mesh instanceof Mesh) || before.has(mesh) || !mesh.material) continue;
    if (mesh.material.needAlphaBlending()) continue;
    const cast = mesh.metadata?.castShadow !== false;
    const key = `${mesh.material.uniqueId}:${cast ? 1 : 0}`;
    const group = grouped.get(key) ?? [];
    group.push(mesh);
    grouped.set(key, group);
  }
  for (const meshes of grouped.values()) {
    if (meshes.length < 2) continue;
    const material = meshes[0]?.material;
    if (!(material instanceof PBRMaterial)) continue;
    const cast = meshes[0]?.metadata?.castShadow !== false;
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (merged) finish(merged, material, cast);
  }
}

/** Build the detailed coastal Art Deco street and its central social square. */
export function buildStreet(scene: Scene, radius: number): AbstractMesh[] {
  const before = new Set<AbstractMesh>(scene.meshes);
  const p = palette(scene);
  buildSurface(scene, radius, p);
  for (const bench of STREET_BENCHES) buildBench(scene, bench, p);
  for (const palm of STREET_PALMS) buildPalm(scene, palm, p);
  mergeOpaqueStreetMeshes(scene, before);
  // Keep temporary architecture separate so the authored GLB can replace it
  // without removing paving, trees or furniture that share its materials.
  const beforeArchitecture = new Set<AbstractMesh>(scene.meshes);
  for (const building of STREET_BUILDINGS) buildBuilding(scene, building, p);
  mergeOpaqueStreetMeshes(scene, beforeArchitecture);
  const architecture = scene.meshes.filter(mesh => !beforeArchitecture.has(mesh));
  for (const mesh of scene.meshes) {
    if (before.has(mesh) || mesh.name.includes(":glass") || mesh.name.includes("frond")) continue;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }
  return architecture;
}
