import { v2ServiceHref } from "@/lib/v2-service-href";

/*
 * 同じ面の中の道を組み立てる（2026-09-04）。
 *
 * **ここに "use client" を書かない。** サーバーの部品もこの関数を呼ぶ。
 * 一度 use-hub-ui-surface.ts（"use client"）に置いたら、取引の画面が
 *   Attempted to call hubSurfacePath() from the server but it is on the client
 * で丸ごと落ちた。型検査は通る。画面を開いて初めて分かる。
 *
 * 面の判定（URL を読む）はクライアントの仕事なので、そちらは
 * use-hub-ui-surface.ts に残す。サーバーの部品は面を props で受け取る。
 *
 * **v2 に同じ画面が在るかは v2ServiceHref が経路の一覧から判断する。**
 * 手で「これは v2 に在る」と並べると必ず腐る。無ければ既存の道のまま——
 * 行けないより、v1 へ渡すほうがいい。
 */
export type HubUiSurface = "" | "/v2";

/* 頭に "/" が無いもの（外部の URL、#見出し）はそのまま返る。 */
export function hubSurfacePath(surface: HubUiSurface, path: string): string {
  if (surface !== "/v2") return path;
  return v2ServiceHref(path) ?? path;
}
