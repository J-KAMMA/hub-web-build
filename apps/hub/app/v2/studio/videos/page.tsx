import type { Metadata } from "next";

import { NativeVideoStudio } from "@/components/native-video-studio";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { notFound } from "next/navigation";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "動画の投稿 | Hub v2" };

/*
 * 自作動画の投稿と管理（docs/hub-video/PLAN.md 4.2 のスタジオ）。動画の本体はブラウザから
 * Video Worker へ直接送る。Hub は札と記録だけを持つ。Video Worker が無い Hub では出さない。
 */
export default function V2VideoStudioPage() {
  if (!isOptionalServiceEnabled("video")) notFound();
  return (
    <V2PanelPage currentPath="/v2/videos" title="動画の投稿" panelOwnsHeading={false} wide>
      <NativeVideoStudio />
    </V2PanelPage>
  );
}
