import { openWorld } from "./main";

/**
 * 単体の頁として開く。
 *
 * **画面の中身は index.html にある。** ここは、その部品を集めて `openWorld` に
 * 渡すだけ。Hub の中（/world）でも同じ関数を呼ぶので、世界の作りは1つで済む。
 */
const pick = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`画面に ${id} が無い`);
  return found as T;
};

openWorld({
  canvas: pick<HTMLCanvasElement>("stage"),
  roster: pick("roster"),
  banner: pick("banner"),
  doors: pick("doors"),
  shelf: pick("shelf"),
  log: pick("log"),
  sayForm: pick<HTMLFormElement>("say"),
  line: pick<HTMLInputElement>("line"),
  controls: pick("controls")
});
