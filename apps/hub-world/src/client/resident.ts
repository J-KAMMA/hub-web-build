import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/** A small, self-contained visitor that can be moved by the world client. */
export type Resident = {
  root: TransformNode;
  look: string;
  wasAt: Vector3;
  walking: boolean;
  drop(): void;
  update(deltaSeconds: number): void;
};

type Palette = {
  jacket: Color3;
  shirt: Color3;
  trousers: Color3;
  shoes: Color3;
  hair: Color3;
  skin: Color3;
};

type ResidentMaterials = {
  jacket: PBRMaterial;
  shirt: PBRMaterial;
  trousers: PBRMaterial;
  shoes: PBRMaterial;
  hair: PBRMaterial;
  skin: PBRMaterial;
  faceDetail: PBRMaterial;
};

const palette = (jacket: Color3, shirt: Color3, trousers: Color3, shoes: Color3, hair: Color3): Palette => ({
  jacket,
  shirt,
  trousers,
  shoes,
  hair,
  skin: new Color3(0.58, 0.34, 0.23)
});

const PALETTES: Record<string, Palette> = {
  "": palette(
    new Color3(0.22, 0.28, 0.29),
    new Color3(0.76, 0.72, 0.63),
    new Color3(0.16, 0.18, 0.19),
    new Color3(0.65, 0.63, 0.58),
    new Color3(0.08, 0.06, 0.045)
  ),
  wakaba: palette(
    new Color3(0.28, 0.40, 0.32),
    new Color3(0.80, 0.78, 0.68),
    new Color3(0.20, 0.24, 0.21),
    new Color3(0.68, 0.66, 0.58),
    new Color3(0.10, 0.065, 0.04)
  ),
  asagi: palette(
    new Color3(0.22, 0.39, 0.41),
    new Color3(0.78, 0.82, 0.77),
    new Color3(0.17, 0.24, 0.26),
    new Color3(0.66, 0.68, 0.64),
    new Color3(0.08, 0.07, 0.055)
  ),
  sumi: palette(
    new Color3(0.16, 0.17, 0.19),
    new Color3(0.62, 0.64, 0.63),
    new Color3(0.11, 0.12, 0.14),
    new Color3(0.25, 0.27, 0.28),
    new Color3(0.035, 0.027, 0.023)
  ),
  nanohana: palette(
    new Color3(0.58, 0.42, 0.16),
    new Color3(0.85, 0.80, 0.58),
    new Color3(0.24, 0.25, 0.19),
    new Color3(0.70, 0.65, 0.52),
    new Color3(0.16, 0.075, 0.03)
  ),
  usumomo: palette(
    new Color3(0.55, 0.30, 0.33),
    new Color3(0.84, 0.72, 0.68),
    new Color3(0.26, 0.22, 0.27),
    new Color3(0.72, 0.65, 0.62),
    new Color3(0.15, 0.06, 0.05)
  )
};

// Materials belong to a scene, so a resident can be dropped without taking a
// shared outfit away from its neighbours. WeakMap also lets a disposed scene go.
const materialsByScene = new WeakMap<Scene, Map<string, ResidentMaterials>>();
let residentNumber = 0;

function material(scene: Scene, name: string, color: Color3, roughness = 0.72): PBRMaterial {
  const made = new PBRMaterial(`resident:${name}`, scene);
  made.albedoColor = color;
  made.metallic = 0.04;
  made.roughness = roughness;
  return made;
}

function materialsFor(scene: Scene, look: string): ResidentMaterials {
  let sceneMaterials = materialsByScene.get(scene);
  if (!sceneMaterials) {
    sceneMaterials = new Map();
    materialsByScene.set(scene, sceneMaterials);
  }
  const cached = sceneMaterials.get(look);
  if (cached) return cached;

  const colors = PALETTES[look] ?? PALETTES[""];
  // The palette values are module constants; the fallback is always present.
  const selected = colors!;
  const made: ResidentMaterials = {
    jacket: material(scene, `${look || "default"}:jacket`, selected.jacket),
    shirt: material(scene, `${look || "default"}:shirt`, selected.shirt, 0.82),
    trousers: material(scene, `${look || "default"}:trousers`, selected.trousers),
    shoes: material(scene, `${look || "default"}:shoes`, selected.shoes, 0.55),
    hair: material(scene, `${look || "default"}:hair`, selected.hair, 0.92),
    skin: material(scene, `${look || "default"}:skin`, selected.skin, 0.9),
    faceDetail: material(scene, `${look || "default"}:face-detail`, new Color3(0.055, 0.035, 0.03), 0.9)
  };
  sceneMaterials.set(look, made);
  return made;
}

function shadowReady<T extends AbstractMesh>(mesh: T, skin: PBRMaterial): T {
  mesh.material = skin;
  mesh.receiveShadows = true;
  mesh.metadata = { ...(mesh.metadata ?? {}), castShadow: true };
  return mesh;
}

/** Create a warm Mediterranean-plaza visitor from smooth Babylon primitives. */
export function createResident(scene: Scene, look = ""): Resident {
  const chosenLook = Object.prototype.hasOwnProperty.call(PALETTES, look) ? look : "";
  const mats = materialsFor(scene, chosenLook);
  const id = `resident-${residentNumber += 1}`;
  const root = new TransformNode(id, scene);
  const wasAt = new Vector3(0, 0, 0);

  const part = <T extends AbstractMesh>(mesh: T, parent: TransformNode, skin: PBRMaterial): T => {
    mesh.parent = parent;
    return shadowReady(mesh, skin);
  };
  const node = (name: string, position: [number, number, number]): TransformNode => {
    const made = new TransformNode(`${id}:${name}`, scene);
    made.parent = root;
    made.position.set(...position);
    return made;
  };

  // The layered jacket, shirt bib and collar establish a human shoulder/torso
  // silhouette instead of the round, bare shape of a placeholder avatar.
  const torso = part(CreateCapsule(`${id}:jacket`, { height: 0.66, radius: 0.29, tessellation: 16 }, scene), root, mats.jacket);
  torso.position.set(0, 1.13, 0.015);
  torso.scaling.set(1.08, 1, 0.86);
  part(CreateBox(`${id}:shirt`, { width: 0.22, height: 0.38, depth: 0.035 }, scene), root, mats.shirt).position.set(0, 1.25, -0.285);
  const collarL = part(CreateBox(`${id}:collar-l`, { width: 0.15, height: 0.11, depth: 0.045 }, scene), root, mats.shirt);
  collarL.position.set(-0.09, 1.44, -0.275);
  collarL.rotation.z = -0.34;
  const collarR = part(CreateBox(`${id}:collar-r`, { width: 0.15, height: 0.11, depth: 0.045 }, scene), root, mats.shirt);
  collarR.position.set(0.09, 1.44, -0.275);
  collarR.rotation.z = 0.34;
  part(CreateBox(`${id}:belt`, { width: 0.47, height: 0.06, depth: 0.29 }, scene), root, mats.shoes).position.set(0, 0.84, 0);
  part(CreateBox(`${id}:hips`, { width: 0.53, height: 0.22, depth: 0.32 }, scene), root, mats.trousers).position.set(0, 0.78, 0);

  const neck = part(CreateCylinder(`${id}:neck`, { height: 0.16, diameter: 0.16, tessellation: 16 }, scene), root, mats.skin);
  neck.position.set(0, 1.47, 0);
  const head = part(CreateCapsule(`${id}:head`, { height: 0.30, radius: 0.145, tessellation: 16 }, scene), root, mats.skin);
  head.position.set(0, 1.61, 0);
  head.scaling.set(0.94, 1, 0.90);
  const hair = part(CreateSphere(`${id}:hair`, { diameter: 0.40, segments: 16 }, scene), root, mats.hair);
  hair.position.set(0, 1.68, 0.018);
  hair.scaling.set(1, 0.50, 0.94);
  const fringe = part(CreateSphere(`${id}:fringe`, { diameter: 0.25, segments: 12 }, scene), root, mats.hair);
  fringe.position.set(0, 1.60, -0.157);
  fringe.scaling.set(1.35, 0.44, 0.34);
  const nose = part(CreateSphere(`${id}:nose`, { diameter: 0.045, segments: 8 }, scene), root, mats.skin);
  nose.position.set(0, 1.585, -0.168);
  for (const side of [-1, 1]) {
    const ear = part(CreateSphere(`${id}:ear-${side}`, { diameter: 0.075, segments: 10 }, scene), root, mats.skin);
    ear.position.set(side * 0.145, 1.61, -0.005);
    ear.scaling.set(0.60, 1, 0.75);
  }
  for (const side of [-1, 1]) {
    const eye = part(CreateSphere(`${id}:eye-${side}`, { diameter: 0.026, segments: 8 }, scene), root, mats.faceDetail);
    eye.position.set(side * 0.064, 1.625, -0.162);
  }
  for (const side of [-1, 1]) {
    const sideburn = part(CreateCapsule(`${id}:sideburn-${side}`, { height: 0.13, radius: 0.045, tessellation: 10 }, scene), root, mats.hair);
    sideburn.position.set(side * 0.155, 1.61, -0.02);
    sideburn.scaling.z = 0.60;
  }

  const shoulders = [-1, 1].map((side) => node(`shoulder-${side}`, [side * 0.37, 1.39, 0]));
  shoulders.forEach((shoulder, index) => {
    const side = index === 0 ? -1 : 1;
    const upper = part(CreateCapsule(`${id}:upper-arm-${side}`, { height: 0.46, radius: 0.095, tessellation: 12 }, scene), shoulder, mats.jacket);
    upper.position.set(0, -0.22, 0);
    const forearm = part(CreateCapsule(`${id}:forearm-${side}`, { height: 0.40, radius: 0.082, tessellation: 12 }, scene), shoulder, mats.jacket);
    forearm.position.set(0, -0.54, -0.005);
    const hand = part(CreateCapsule(`${id}:hand-${side}`, { height: 0.17, radius: 0.062, tessellation: 10 }, scene), shoulder, mats.skin);
    hand.position.set(0, -0.73, -0.01);
  });

  const hips = [-1, 1].map((side) => node(`hip-${side}`, [side * 0.145, 0.80, 0]));
  hips.forEach((hip, index) => {
    const side = index === 0 ? -1 : 1;
    const thigh = part(CreateCapsule(`${id}:thigh-${side}`, { height: 0.48, radius: 0.145, tessellation: 10 }, scene), hip, mats.trousers);
    thigh.position.set(0, -0.24, 0);
    const calf = part(CreateCapsule(`${id}:calf-${side}`, { height: 0.43, radius: 0.12, tessellation: 10 }, scene), hip, mats.trousers);
    calf.position.set(0, -0.58, 0);
    const shoe = part(CreateCapsule(`${id}:shoe-${side}`, { height: 0.30, radius: 0.095, tessellation: 12 }, scene), hip, mats.shoes);
    // Local -Z is the face/front direction, so the toe is at negative Z too.
    shoe.position.set(0, -0.66, -0.08);
    shoe.rotation.x = Math.PI / 2;
    shoe.scaling.set(0.84, 0.76, 1.08);
  });

  let phase = 0;
  let disposed = false;
  const resident: Resident = {
    root,
    look: chosenLook,
    wasAt,
    walking: false,
    drop: () => {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
    },
    update: (deltaSeconds: number) => {
      if (disposed) return;
      const seconds = Number.isFinite(deltaSeconds) ? Math.min(Math.max(deltaSeconds, 0), 0.1) : 0;
      phase += seconds * (resident.walking ? 8.5 : 1.8);
      const swing = resident.walking ? Math.sin(phase) * 0.34 : Math.sin(phase) * 0.012;
      shoulders[0]!.rotation.x = swing;
      shoulders[1]!.rotation.x = -swing;
      hips[0]!.rotation.x = -swing * 0.78;
      hips[1]!.rotation.x = swing * 0.78;
      // A restrained breath keeps an idle person alive without changing their
      // ground contact or world position.
      torso.scaling.y = 1 + Math.sin(phase * 0.72) * 0.012;
    }
  };
  return resident;
}
