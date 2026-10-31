import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import { isContent, type Item, type ItemKind } from "../world/items";

type BuiltInKit = {
  templates: Partial<Record<ItemKind, Mesh>>;
  materials: StandardMaterial[];
};

/** Each scene owns its templates; one disposed scene cannot invalidate another. */
const kits = new WeakMap<Scene, BuiltInKit>();
const boughtByScene = new WeakMap<Scene, Map<string, Promise<AssetContainer | null>>>();

const skin = (scene: Scene, kit: BuiltInKit, name: string, color: Color3, roughness = 0.8): StandardMaterial => {
  const made = new StandardMaterial(`item:${name}`, scene);
  made.diffuseColor = color;
  made.specularColor = new Color3(0.12, 0.1, 0.08);
  made.roughness = roughness;
  kit.materials.push(made);
  return made;
};

function childBox(scene: Scene, root: Mesh, name: string, size: { width: number; depth: number; height: number }, position: Vector3, material: StandardMaterial): Mesh {
  const made = CreateBox(`item-template:${name}`, size, scene);
  made.position = position;
  made.material = material;
  made.parent = root;
  return made;
}

function childCylinder(scene: Scene, root: Mesh, name: string, options: { diameter?: number; diameterTop?: number; diameterBottom?: number; height: number; tessellation?: number }, position: Vector3, material: StandardMaterial): Mesh {
  const made = CreateCylinder(`item-template:${name}`, options, scene);
  made.position = position;
  made.material = material;
  made.parent = root;
  return made;
}

function childSphere(scene: Scene, root: Mesh, name: string, diameter: number, position: Vector3, material: StandardMaterial): Mesh {
  const made = CreateSphere(`item-template:${name}`, { diameter, segments: 16 }, scene);
  made.position = position;
  made.material = material;
  made.parent = root;
  return made;
}

function chair(scene: Scene, kit: BuiltInKit, wood: StandardMaterial, darkWood: StandardMaterial): Mesh {
  const root = CreateBox("item-template:椅子", { width: 1.65, depth: 1.35, height: 0.16 }, scene);
  root.position.y = 0.86;
  root.material = wood;
  for (const x of [-0.62, 0.62]) for (const z of [-0.48, 0.48]) {
    childBox(scene, root, "椅子脚", { width: 0.14, depth: 0.14, height: 0.86 }, new Vector3(x, -0.43, z), darkWood);
  }
  for (const x of [-0.58, 0, 0.58]) {
    childBox(scene, root, "椅子背", { width: 0.16, depth: 0.14, height: 1.2 }, new Vector3(x, 0.51, 0.55), wood);
  }
  root.setEnabled(false);
  kit.templates.椅子 = root;
  return root;
}

function table(scene: Scene, kit: BuiltInKit, wood: StandardMaterial, darkWood: StandardMaterial): Mesh {
  const root = CreateBox("item-template:机", { width: 1.65, depth: 1.3, height: 0.16 }, scene);
  root.position.y = 1.08;
  root.material = wood;
  for (const x of [-0.6, 0.6]) for (const z of [-0.43, 0.43]) {
    childBox(scene, root, "机脚", { width: 0.16, depth: 0.16, height: 1.08 }, new Vector3(x, -0.54, z), darkWood);
  }
  childBox(scene, root, "机の補強", { width: 1.2, depth: 0.12, height: 0.12 }, new Vector3(0, -0.63, 0), darkWood);
  root.setEnabled(false);
  kit.templates.机 = root;
  return root;
}

function planter(scene: Scene, kit: BuiltInKit, stone: StandardMaterial, foliage: StandardMaterial): Mesh {
  const root = CreateCylinder("item-template:花壇", { diameter: 2.7, height: 0.62, tessellation: 24 }, scene);
  root.position.y = 0.31;
  root.material = stone;
  childCylinder(scene, root, "花壇の土", { diameter: 2.28, height: 0.05, tessellation: 24 }, new Vector3(0, 0.03, 0), darkStone(scene, kit));
  childSphere(scene, root, "花壇の樹冠", 1.95, new Vector3(0, 1.04, 0), foliage);
  root.setEnabled(false);
  kit.templates.花壇 = root;
  return root;
}

function darkStone(scene: Scene, kit: BuiltInKit): StandardMaterial {
  const found = kit.materials.find((one) => one.name === "item:soil");
  return found ?? skin(scene, kit, "soil", new Color3(0.2, 0.14, 0.1));
}

function lamp(scene: Scene, kit: BuiltInKit, metal: StandardMaterial, glow: StandardMaterial): Mesh {
  const root = CreateCylinder("item-template:灯り", { diameter: 0.52, height: 2.7, tessellation: 16 }, scene);
  root.position.y = 1.35;
  root.material = metal;
  childSphere(scene, root, "灯り", 0.7, new Vector3(0, 1.55, 0), glow);
  root.setEnabled(false);
  kit.templates.灯り = root;
  return root;
}

function tree(scene: Scene, kit: BuiltInKit, trunk: StandardMaterial, foliage: StandardMaterial): Mesh {
  const root = CreateCylinder("item-template:木", { diameter: 0.68, height: 2.2, tessellation: 12 }, scene);
  root.position.y = 1.1;
  root.material = trunk;
  childSphere(scene, root, "木の葉", 1.65, new Vector3(0, 2.2, 0), foliage);
  childSphere(scene, root, "木の葉上", 1.15, new Vector3(0.18, 2.95, 0), foliage);
  root.setEnabled(false);
  kit.templates.木 = root;
  return root;
}

function sign(scene: Scene, kit: BuiltInKit, wood: StandardMaterial): Mesh {
  const root = CreateBox("item-template:立て札", { width: 1.5, depth: 0.14, height: 1.05 }, scene);
  root.position.y = 1.45;
  root.material = wood;
  childBox(scene, root, "立て札の柱左", { width: 0.12, depth: 0.12, height: 1.45 }, new Vector3(-0.48, -0.9, 0), wood);
  childBox(scene, root, "立て札の柱右", { width: 0.12, depth: 0.12, height: 1.45 }, new Vector3(0.48, -0.9, 0), wood);
  root.setEnabled(false);
  kit.templates.立て札 = root;
  return root;
}

function buildKit(scene: Scene): BuiltInKit {
  const kit: BuiltInKit = { templates: {}, materials: [] };
  const wood = skin(scene, kit, "wood", new Color3(0.42, 0.25, 0.14));
  const darkWood = skin(scene, kit, "dark-wood", new Color3(0.25, 0.14, 0.08));
  const stone = skin(scene, kit, "stone", new Color3(0.5, 0.47, 0.4));
  const foliage = skin(scene, kit, "foliage", new Color3(0.23, 0.42, 0.22));
  const metal = skin(scene, kit, "lamp-metal", new Color3(0.18, 0.2, 0.2));
  const glow = skin(scene, kit, "lamp-glow", new Color3(0.94, 0.68, 0.25), 0.2);
  chair(scene, kit, wood, darkWood);
  table(scene, kit, wood, darkWood);
  planter(scene, kit, stone, foliage);
  lamp(scene, kit, metal, glow);
  tree(scene, kit, darkWood, foliage);
  sign(scene, kit, wood);
  return kit;
}

/** Build the six built-in catalogue items locally; `assets` is intentionally unused. */
export async function loadThings(scene: Scene, assets = ""): Promise<boolean> {
  void assets;
  if (!kits.has(scene)) kits.set(scene, buildKit(scene));
  return true;
}

type Shown = { root: TransformNode | null; sign: Mesh | null };

async function loadBought(scene: Scene, content: string, assets: string): Promise<AssetContainer | null> {
  let cache = boughtByScene.get(scene);
  if (!cache) {
    cache = new Map();
    boughtByScene.set(scene, cache);
  }
  const held = cache.get(content);
  if (held) return held;
  const asked = import("@babylonjs/loaders/glTF")
    .then(() => LoadAssetContainerAsync(`${assets}/bought/${encodeURIComponent(content)}.glb`, scene))
    .catch((error) => {
      console.warn("買った物を読めない: " + content, error);
      return null;
    });
  cache.set(content, asked);
  return asked;
}

/** Render user-authored sign text on a board without treating it as markup. */
function signFace(scene: Scene, text: string): Mesh {
  const size = 512;
  const paper = new DynamicTexture("立て札の面", { width: size, height: size / 2 }, scene, false);
  const pen = paper.getContext();
  pen.fillStyle = "#e6dcc2";
  pen.fillRect(0, 0, size, size / 2);
  paper.drawText(text, null, 150, "bold 44px sans-serif", "#3a2f1e", "transparent", true);

  const material = new StandardMaterial("立て札の材質", scene);
  material.diffuseTexture = paper;
  material.specularColor.set(0, 0, 0);
  const face = CreatePlane("立て札の文字", { width: 1.36, height: 0.6 }, scene);
  face.material = material;
  return face;
}

/** Show exactly the server-provided list and remove anything the server removed. */
export function showThings(scene: Scene, shown: Map<string, Shown>, items: readonly Item[], assets = ""): void {
  const here = new Set(items.map((one) => one.id));
  for (const [id, made] of shown) {
    if (here.has(id)) continue;
    made.sign?.dispose();
    // Built-in clones share the kit materials; do not dispose those materials when one item leaves.
    made.root?.dispose(false, false);
    shown.delete(id);
  }

  const kit = kits.get(scene);
  if (!kit) return;
  for (const item of items) {
    if (shown.has(item.id)) continue;
    if (item.kind === "買った物") {
      if (!isContent(item.content)) continue;
      shown.set(item.id, { root: null, sign: null });
      void loadBought(scene, item.content, assets).then((stockBought) => {
        if (!stockBought || scene.isDisposed || !shown.has(item.id)) return;
        const made = stockBought.instantiateModelsToScene((name) => name, false);
        const root = made.rootNodes[0] as TransformNode;
        root.position = new Vector3(item.x, 0, item.z);
        root.rotation = new Vector3(0, item.facing, 0);
        shown.set(item.id, { root, sign: null });
      });
      continue;
    }
    const source = kit.templates[item.kind];
    if (!source) continue;
    const root = source.clone(`物${item.id}`, null) as Mesh;
    if (!root) continue;
    root.position = new Vector3(item.x, 0, item.z);
    root.rotation = new Vector3(0, item.facing, 0);
    root.setEnabled(true);
    let face: Mesh | null = null;
    if (item.kind === "立て札" && item.text) {
      face = signFace(scene, item.text);
      face.position = new Vector3(
        item.x - Math.cos(item.facing) * 0.08,
        1.55,
        item.z + Math.sin(item.facing) * 0.08
      );
      face.rotation = new Vector3(0, item.facing, 0);
    }
    shown.set(item.id, { root, sign: face });
  }
}
