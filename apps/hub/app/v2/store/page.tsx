import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/*
 * ストアは畳んだ（2026-09-04、旦那様の決定）。
 *
 * 商品を24件並べるだけで、検索も絞り込みもカートも無かった。/v2/market の
 * 実物の区画と同じものを、機能を落として出していた。あって無いものは1つも
 * 無いので、マーケットへ渡す。どこからも指されていなかった画面なので、
 * ここへ来るのは URL を持っている人だけ。404 にはせず転送する。
 */
export default function V2StorePage() {
  redirect("/v2/market");
}
