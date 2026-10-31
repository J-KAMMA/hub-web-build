"use client";

import { createContext, useContext } from "react";

import type { HubUiSurface } from "@/lib/hub-surface-path";

/*
 * いま見ている面を配る（2026-09-04）。
 *
 * 共有の部品は /market と /v2/market の両方から描かれる。行き先を "/profile/…"
 * と焼き込むと、v2 の利用者が人の名前を押した瞬間に既存の画面へ出て、左列も
 * 右列も変わる。今日それを5回別々に直した。1つずつ props で根を渡すと、
 * 渡し忘れが次の漏れになる。
 *
 * **URL（usePathname）では配らない。** 一度そうしたら、next/navigation を
 * 模している検査26ファイルのうち usePathname を持つのは2つだけで、
 * 94件が落ちた。検査を通すために26ファイルを書き換えるのは筋が違う。
 *
 * 既定は既存の面。v2 の外郭（V2Shell）だけが "/v2" を配る。
 * 包まれていない部品は今までどおり動く。
 */
const HubSurfaceContext = createContext<HubUiSurface>("");

export function HubSurfaceProvider({ surface, children }: { surface: HubUiSurface; children: React.ReactNode }) {
  return <HubSurfaceContext.Provider value={surface}>{children}</HubSurfaceContext.Provider>;
}

export function useHubUiSurface(): HubUiSurface {
  return useContext(HubSurfaceContext);
}
