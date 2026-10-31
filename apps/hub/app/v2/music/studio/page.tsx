import type { Metadata } from "next";

import { MusicStudio } from "@/components/music-studio";
import { MusicSectionNav } from "@/components/music-section-nav";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../v2.css";
import "../../v2-media.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "スタジオ | 音楽 | Hub v2" };

export default function V2MusicStudioPage() {
  return (
    <V2PanelPage currentPath="/v2/music/studio" title="スタジオ">
      <MusicSectionNav current="studio" />
      <MusicStudio />
    </V2PanelPage>
  );
}
