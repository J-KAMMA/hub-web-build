/**
 * 誰でも選べる姿。
 *
 * **買った物と同じ仕組みに乗せるが、許可は要らない。** 姿を替える道は1本で、
 * 通るのが備え付けか買った物かだけが違う。道を2本にすると、片方だけ塞ぎ忘れる。
 *
 * 名前を英数にしているのは、そのまま道の一部になるため（`/looks/asagi.glb`）。
 * 見せる名前は別に持つ。
 */

export type Look = { id: string; label: string };

/**
 * 備え付けの姿。**空文字も1つの姿**——既定の住人で、脱いだ状態でもある。
 *
 * 骨と動きは全員同じ。違うのは色だけなので、`歩く` は1つで済むし、後から
 * 買った体を足しても、動きを作り直さずに済む。
 */
export const FREE_LOOKS: readonly Look[] = [
  { id: "", label: "既定" },
  { id: "usumomo", label: "うすもも" },
  { id: "asagi", label: "あさぎ" },
  { id: "nanohana", label: "なのはな" },
  { id: "sumi", label: "すみ" },
  { id: "wakaba", label: "わかば" }
];

const FREE = new Set(FREE_LOOKS.map((one) => one.id));

/** 備え付けかどうか。**買った物の名前と衝突しないことは、ここで保証しない。** */
export function isFreeLook(look: string): boolean {
  return FREE.has(look);
}
