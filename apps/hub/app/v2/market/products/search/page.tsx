import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/*
 * 実物の横断検索。既存の Marketplace（2列の格子）を v2 の本文に置くと、列の指定を
 * 消しても中の配置が崩れた（2026-09-03、1440px で実測）。v2 のマーケットは同じ商品を
 * 語・分類・タグ・並びで絞れるので、そこへ渡す。価格比較は商品の詳細、欲しいものは
 * /v2/lists が持つ。
 */
export default async function V2MarketSearchPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string }> }) {
  const requested = await searchParams;
  const next = new URLSearchParams();
  const query = requested.q?.trim().slice(0, 120);
  const tag = requested.tag?.trim().slice(0, 40);
  if (query) next.set("q", query);
  if (tag && tag !== "all") next.set("tag", tag);
  const search = next.toString();
  redirect(`/v2/market${search ? `?${search}` : ""}`);
}
