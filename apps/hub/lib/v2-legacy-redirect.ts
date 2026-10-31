import { permanentRedirect, redirect } from "next/navigation";

/* 恒久的に移った v2 の道（308）。クエリの扱いは toV2 と同じ。 */
export function toV2Permanent(
  target: string,
  searchParams?: Record<string, string | string[] | undefined>,
): never {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  const query = params.toString();
  permanentRedirect(query ? `${target}${target.includes("?") ? "&" : "?"}${query}` : target);
}

/*
 * 既存ページを v2 の正規UIへ渡すための一箇所（2026-09-19、v2 を正規UIへ昇格）。
 *
 * 旧ページは本文を描かず、同じ機能を持つ v2 の道へ転送する。検索条件などの
 * クエリは名前と繰り返しを保ったまま付け替える。行き先にクエリが付いている
 * 場合（/v2/lists?tab=wishlist など）は & で繋ぐ。
 */
export function toV2(
  target: string,
  searchParams?: Record<string, string | string[] | undefined>,
): never {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  const query = params.toString();
  redirect(query ? `${target}${target.includes("?") ? "&" : "?"}${query}` : target);
}
