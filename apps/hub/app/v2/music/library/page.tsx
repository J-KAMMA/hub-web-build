import type { Metadata } from "next";

import { MusicLibrary } from "@/components/music-library";
import { MusicSectionNav } from "@/components/music-section-nav";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../v2.css";
import "../../v2-media.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ライブラリ | 音楽 | Hub v2" };

export default function V2MusicLibraryPage() {
  return (
    <V2PanelPage currentPath="/v2/music/library" title="ライブラリ">
      <MusicSectionNav current="library" />
      <MusicLibrary />
    </V2PanelPage>
  );
}
