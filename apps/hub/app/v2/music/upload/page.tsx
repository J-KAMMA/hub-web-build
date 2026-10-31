import type { Metadata } from "next";

import { MusicUploadPanel } from "@/components/music-upload-panel";
import { MusicSectionNav } from "@/components/music-section-nav";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../../music.css";
import "../../v2.css";
import "../../v2-media.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "原盤のアップロード | Hub v2" };

/*
 * 原盤のアップロード（2026-09-04、旦那様の「古いUIを出さない」）。
 *
 * 既存では音楽の画面（MusicDiscovery）の中に埋まっていて、v2 からは
 * 「原盤のアップロード」で /music へ渡していた。押すと古いUIへ出る。
 * 部品だけを取り出して v2 の器に置く。中身は作り直さない——安全検査と
 * 権利の確認を持っているので触らない。
 */
export default function V2MusicUploadPage() {
  return (
    <V2PanelPage currentPath="/v2/music" title="原盤のアップロード">
      <MusicSectionNav current="upload" />
      <MusicUploadPanel inline />
    </V2PanelPage>
  );
}
