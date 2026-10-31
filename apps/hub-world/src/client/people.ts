import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import { isFreeLook } from "../world/looks";

/**
 * 住人を置く。
 *
 * **1体を読んで、複製する。** 人数ぶん読み込むと、同じものを何十回も取りに行く
 * ことになる。骨と動きも複製が要るので、instantiateModelsToScene を使う——
 * ただのメッシュ複製だと、全員が同じ骨を共有して同じ動きをする。
 */
export type Person = {
  root: TransformNode;
  idle: AnimationGroup | null;
  walk: AnimationGroup | null;
  /** 直前の位置。歩いているかどうかは、動いたかどうかで決める。 */
  wasAt: Vector3;
  walking: boolean;
  /** いま着ている姿。**替わったら作り直す**ので、憶えておく。 */
  look: string;
  /** 片付ける。**姿を替えるときは、前の体を消す。** 残すと二重に立つ。 */
  drop: () => void;
};

/**
 * 姿ごとの型紙。空文字が既定の住人で、それ以外は買った品の名前。
 *
 * **1つの姿につき1回だけ読む。** 同じ体を着た人が10人居ても、取りに行くのは
 * 1度でいい。読めなかったものも憶える——読めない品を毎こま取りに行くと、
 * 画面が止まる。
 */
const stock = new Map<string, AssetContainer | null>();
const loading = new Map<string, Promise<AssetContainer | null>>();

async function fetchLook(scene: Scene, assets: string, look: string): Promise<AssetContainer | null> {
  // **買った品の名前は他人が決めた文字列。** 道を組み立てる前に逃がす。
  //
  // 備え付けの姿は別の棚から出す。買った物と同じ棚に置くと、品の名前が
  // 備え付けと同じだったときにどちらが出るか決まらない。
  const where = !look
    ? `${assets}/avatar.glb`
    : isFreeLook(look)
      ? `${assets}/looks/${look}.glb`
      : `${assets}/bought/${encodeURIComponent(look)}.glb`;
  try {
    return await LoadAssetContainerAsync(where, scene);
  } catch (error) {
    // **理由を握り潰さない。** 黙ってカプセルへ落ちると、資産が無いのか
    // 読めないのかが分からない。
    console.warn("住人を読めない: " + (look || "既定"), error);
    return null;
  }
}

/**
 * その姿を、使える所まで持ってくる。
 *
 * 読み終わっていれば true。まだなら取りに行きつつ false を返す——**待たない。**
 * 待つと、1人の姿が読めるまで世界ぜんぶが止まる。
 */
export function haveLook(scene: Scene, assets: string, look: string): boolean {
  if (stock.has(look)) return stock.get(look) !== null;
  if (!loading.has(look)) {
    loading.set(look, fetchLook(scene, assets, look).then((got) => {
      stock.set(look, got);
      loading.delete(look);
      return got;
    }));
  }
  return false;
}

export async function loadPeople(scene: Scene, assets = ""): Promise<boolean> {
  const got = await fetchLook(scene, assets, "");
  stock.set("", got);
  return got !== null;
}

export function spawnPerson(look = ""): Person | null {
  const container = stock.get(look);
  if (!container) return null;
  const made = container.instantiateModelsToScene((name) => name, false, { doNotInstantiate: false });
  const root = made.rootNodes[0] as TransformNode;
  const find = (part: string) =>
    made.animationGroups.find((one) => one.name.includes(part)) ?? null;
  const person: Person = {
    root,
    idle: find("立つ"),
    walk: find("歩く"),
    wasAt: new Vector3(0, 0, 0),
    walking: false,
    look,
    drop: () => made.dispose()
  };
  person.walk?.stop();
  person.idle?.play(true);
  return person;
}

/** 歩いているかどうかで、動きを切り替える。 */
export function setWalking(person: Person, walking: boolean): void {
  if (person.walking === walking) return;
  person.walking = walking;
  if (walking) {
    person.idle?.stop();
    person.walk?.play(true);
  } else {
    person.walk?.stop();
    person.idle?.play(true);
  }
}
