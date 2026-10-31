import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { buildStreet } from "./street";
import { buildGarden } from "./gardens";
import { streetMaterial } from "./surfaces";
import { CITY_LAYOUT } from "../world/zones";
import type { Scene } from "@babylonjs/core/scene";
// **登録のためだけの取り込み。** Babylon は必要な部分だけを入れる作りなので、
// 機能ごとに「登録する取り込み」が別に要る。無いと、使った瞬間に例外になる。
// 実測: glTF だけ入れて LoadingScreen を忘れ、
// 「LoadingScreen needs to be imported before」で街並みが読めなかった。

import type { Style } from "../world/zones";

/**
 * 区画の地面と空。**様式ごとに変える。**
 *
 * 「いろんなの」を作ると決めたので、地面を1つに決め打ちしない。ここが
 * 差し替えられる限り、現代都市の隣に近未来を置いても、後から幻想を足しても、
 * 地面から作り直さずに済む。
 *
 * 今は色と簡単な立体だけ。**Blender の資産が出来たら、この関数の中身だけを
 * 差し替える。** 呼ぶ側は様式の名前しか知らない。
 */

type Look = {
  /** 空の色。霧もここに合わせる。 */
  sky: Color4;
  ground: Color3;
  /** 目印になる立体の色。 */
  mark: Color3;
  /** 光の強さ。夜の街と昼の広場では違う。 */
  light: number;
};

const LOOKS: Record<Style, Look> = {
  /**
   * 街。**灰色にしない。**
   *
   * 都会を写すと、地面も壁も空も灰に寄る。同じ地方の中で絵の作りが変わると、
   * 繋がった土地に見えなくなる——**空は草地と同じ青のまま**、地面だけを
   * 舗装の色にする。
   */
  都会: {
    sky: new Color4(0.53, 0.76, 0.93, 1),
    ground: new Color3(0.72, 0.70, 0.68),
    mark: new Color3(0.95, 0.90, 0.80),
    light: 1.15
  },
  /**
   * 昼の草地。**濁らせない。**
   *
   * 現実の草は灰と黄が混じるが、それを写すと沈む。ここは絵で、**空も草も
   * 記憶の色に寄せる**——晴れた日にそう見えたと思っている色に。
   */
  牧歌: {
    sky: new Color4(0.53, 0.76, 0.93, 1),
    ground: new Color3(0.42, 0.66, 0.32),
    mark: new Color3(0.93, 0.86, 0.68),
    light: 1.15
  },
  /** 木の下。**暗くはしない。** 木もれ日なので、緑を通した明るさにする。 */
  森: {
    sky: new Color4(0.44, 0.62, 0.5, 1),
    ground: new Color3(0.26, 0.44, 0.24),
    mark: new Color3(0.72, 0.66, 0.44),
    light: 0.95
  },
  /** 海辺。砂は白に寄せると飛ぶので、少し赤を残す。 */
  浜: {
    sky: new Color4(0.62, 0.83, 0.94, 1),
    ground: new Color3(0.86, 0.78, 0.6),
    mark: new Color3(0.36, 0.66, 0.72),
    light: 1.25
  },
  現代都市: {
    sky: new Color4(0.68, 0.74, 0.82, 1),
    ground: new Color3(0.34, 0.35, 0.37),
    mark: new Color3(0.55, 0.57, 0.6),
    light: 1.0
  },
  近未来: {
    sky: new Color4(0.05, 0.06, 0.1, 1),
    ground: new Color3(0.09, 0.1, 0.13),
    mark: new Color3(0.2, 0.85, 0.85),
    light: 0.45
  },
  幻想: {
    sky: new Color4(0.5, 0.42, 0.62, 1),
    ground: new Color3(0.24, 0.3, 0.22),
    mark: new Color3(0.85, 0.72, 0.4),
    light: 0.85
  },
  自作: {
    sky: new Color4(0.5, 0.52, 0.55, 1),
    ground: new Color3(0.4, 0.4, 0.42),
    mark: new Color3(0.7, 0.7, 0.72),
    light: 0.9
  }
};

export function lookOf(style: Style): Look {
  return LOOKS[style] ?? LOOKS.自作;
}

/**
 * 地面を敷き、縁と目印を置く。
 *
 * **縁を置く。** 地面だけだと、どこまで歩けるのかが分からない。サーバは
 * 半径で止めるので、そこに見えるものが無いと「動かなくなった」と感じる。
 */
export function buildGround(scene: Scene, style: Style, radius: number): void {
  const look = lookOf(style);
  scene.clearColor = look.sky;

  const floor = CreateGround("地面", { width: radius * 2.4, height: radius * 2.4, subdivisions: 2 }, scene);
  const floorSkin = new PBRMaterial("地面の材質", scene);
  floorSkin.albedoColor = look.ground;
  floorSkin.metallic = 0.1;
  floorSkin.roughness = 0.9;
  floor.material = floorSkin;

  const markSkin = new PBRMaterial("目印の材質", scene);
  markSkin.albedoColor = look.mark;
  markSkin.metallic = 0.3;
  markSkin.roughness = 0.5;

  // 縁。歩ける範囲を目に見えるようにする。
  const posts = 36;
  for (let index = 0; index < posts; index += 1) {
    const angle = (index / posts) * Math.PI * 2;
    const post = CreateCylinder(`縁${index}`, { diameter: 0.5, height: 1.6, tessellation: 6 }, scene);
    post.position = new Vector3(Math.cos(angle) * radius, 0.8, Math.sin(angle) * radius);
    post.material = markSkin;
  }

  // 中心の目印。**向きが分からないと、動いているのかどうかも分からない。**
  const centre = CreateBox("中心", { width: 4, depth: 4, height: 0.3 }, scene);
  centre.position = new Vector3(0, 0.15, 0);
  centre.material = markSkin;

  // 北を示す一本。回っているのが自分か世界かを見分けられる。
  const north = CreateBox("北", { width: 0.6, depth: 6, height: 0.3 }, scene);
  north.position = new Vector3(0, 0.16, radius * 0.45);
  north.material = markSkin;
}

/**
 * 彫った街並みを読む。**無ければ素の地面のまま。**
 *
 * 資産が出来ていない区画でも入れること。読めないから真っ暗、では歩けない。
 */
const landscapes = new WeakMap<Scene, { base: AssetContainer; architecture?: AssetContainer }>();

/** Every supported district is generated locally from the server's shared layout. */
export async function loadZone(scene: Scene, zone: string, _style: Style, radius: number, assets = "", layout?: string, ready?: () => void): Promise<boolean> {
  const previous = landscapes.get(scene);
  previous?.architecture?.dispose();
  previous?.base.dispose();
  landscapes.delete(scene);
  if (scene.isDisposed || layout !== CITY_LAYOUT || !["city", "route", "forest", "shore"].includes(zone)) return false;
  const meshes = new Set(scene.meshes), materials = new Set(scene.materials);
  const textures = new Set(scene.textures), nodes = new Set(scene.transformNodes);
  let temporaryArchitecture: AbstractMesh[] = [];
  if (zone === "city") temporaryArchitecture = buildStreet(scene, radius);
  else buildGarden(scene, zone, radius);
  const container = new AssetContainer(scene);
  container.meshes = scene.meshes.filter(mesh => !meshes.has(mesh));
  container.materials = scene.materials.filter(material => !materials.has(material) && material !== scene.defaultMaterial);
  container.textures = scene.textures.filter(texture => !textures.has(texture));
  container.transformNodes = scene.transformNodes.filter(node => !nodes.has(node));
  const landscape: { base: AssetContainer; architecture?: AssetContainer } = { base: container };
  landscapes.set(scene, landscape);
  if (zone === "city") {
    // Keep the synchronous shared layout usable while the original Blender art
    // downloads. Ownership checks prevent a late response reviving an old zone.
    void import("@babylonjs/loaders/glTF")
      .then(() => LoadAssetContainerAsync(`${assets}/street-architecture.glb`, scene))
      .then(authored => {
        if (scene.isDisposed || landscapes.get(scene) !== landscape) { authored.dispose(); return; }
        if (!authored.meshes.some(mesh => mesh.getTotalVertices() > 0)) { authored.dispose(); return; }
        landscape.architecture = authored;
        authored.addAllToScene();
        // Preserve the authored facade colours while adding the locally
        // generated fine plaster grain under moving light.
        const plaster = streetMaterial(scene, "stucco");
        for (const material of authored.materials) {
          if (material instanceof PBRMaterial && /stucco|concrete|shell/i.test(material.name)) {
            material.albedoTexture = plaster.albedoTexture;
            material.bumpTexture = plaster.bumpTexture;
          }
        }
        for (const mesh of authored.meshes) {
          mesh.isPickable = false;
          mesh.receiveShadows = true;
          mesh.metadata = { ...mesh.metadata, authoredIn: "Blender", streetArchitecture: true, castShadow: true };
          mesh.computeWorldMatrix(true);
          mesh.freezeWorldMatrix();
        }
        for (const mesh of temporaryArchitecture) mesh.dispose(false, false);
        container.meshes = container.meshes.filter(mesh => !temporaryArchitecture.includes(mesh));
        ready?.();
      }).catch(() => {
        if (!scene.isDisposed && landscapes.get(scene) === landscape) console.warn("街の詳細モデルを読み込めません。簡易表示を継続します。");
      });
  }
  return true;
}
