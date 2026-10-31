import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createResident, type Resident } from "./resident";

const stock = new WeakMap<Scene, Map<string, Promise<AssetContainer | null>>>();
function template(scene: Scene, assets: string) {
  let cache = stock.get(scene);
  if (!cache) { cache = new Map(); stock.set(scene, cache); }
  const url = `${assets}/street-resident.glb`;
  let loading = cache.get(url);
  if (!loading) {
    loading = import("@babylonjs/loaders/glTF").then(() => LoadAssetContainerAsync(url, scene)).then(container => {
      if (scene.isDisposed) { container.dispose(); return null; }
      scene.onDisposeObservable.addOnce(() => container.dispose());
      return container;
    }).catch(() => { if (!scene.isDisposed) console.warn("新しい人物モデルを読み込めません。簡易表示を継続します。"); return null; });
    cache.set(url, loading);
  }
  return loading;
}

/** One download per scene; each visitor owns their own skeleton and animations. */
export function createStreetResident(scene: Scene, look: string, assets: string, ready: (mesh: AbstractMesh) => void): Resident {
  const fallback = createResident(scene, look);
  const oldChildren = fallback.root.getChildren();
  const fallbackUpdate = fallback.update;
  let entry: InstantiatedEntries | null = null, closed = false;
  let idle: AnimationGroup | undefined, walk: AnimationGroup | undefined, moving: boolean | undefined;
  const ownMaterials: PBRMaterial[] = [];
  const resident: Resident = {
    root: fallback.root, look, wasAt: fallback.wasAt, walking: false,
    update(delta) {
      if (closed) return;
      if (!entry) { fallback.walking = resident.walking; fallbackUpdate(delta); return; }
      if (moving === resident.walking) return;
      moving = resident.walking;
      if (moving) { idle?.stop(); walk?.start(true, 1); }
      else { walk?.stop(); idle?.start(true, 1); }
    },
    drop() {
      if (closed) return; closed = true;
      entry?.dispose(); fallback.drop();
      ownMaterials.forEach(material => material.dispose());
    }
  };
  void template(scene, assets).then(container => {
    if (!container || closed || scene.isDisposed) return;
    entry = container.instantiateModelsToScene(name => `visitor:${name}`, false, { doNotInstantiate: true });
    oldChildren.forEach(child => child.dispose(false, false));
    const orientation = new TransformNode("visitor:forward", scene);
    orientation.parent = resident.root; orientation.rotation.y = Math.PI;
    for (const node of entry.rootNodes) node.parent = orientation;
    const tints: Record<string, string> = { wakaba: "#52644c", asagi: "#496773", sumi: "#30343b", nanohana: "#877346", usumomo: "#805e65" };
    const variants = new Map<PBRMaterial, PBRMaterial>();
    for (const mesh of resident.root.getChildMeshes()) {
      mesh.metadata = { ...mesh.metadata, castShadow: true, authoredIn: "Blender" };
      mesh.receiveShadows = true;
      if (tints[look] && mesh.material instanceof PBRMaterial && /jacket|shirt|coat/i.test(mesh.material.name)) {
        let material = variants.get(mesh.material);
        if (!material) {
          material = mesh.material.clone(`visitor:${look}:${mesh.material.name}`);
          material.albedoColor = Color3.FromHexString(tints[look]!);
          variants.set(mesh.material, material); ownMaterials.push(material);
        }
        mesh.material = material;
      }
      ready(mesh);
    }
    idle = entry.animationGroups.find(group => /idle/i.test(group.name));
    walk = entry.animationGroups.find(group => /walk/i.test(group.name));
    entry.animationGroups.forEach(group => group.stop());
    resident.update(0);
  });
  return resident;
}
