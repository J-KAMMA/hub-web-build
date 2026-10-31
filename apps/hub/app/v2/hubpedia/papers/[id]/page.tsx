import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HubpediaPaper } from "@/components/hubpedia-paper";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubpediaResearchWork } from "@/lib/server/hubpedia-research-knowledge";

import "../../../v2.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const work = await getHubpediaResearchWork(getHubD1(), id);
    return work
      ? { title: `${work.title} | Hubpedia | Hub v2`, description: work.abstract ?? "Hubpediaの論文情報" }
      : { title: "論文が見つかりません | Hubpedia | Hub v2", robots: { index: false, follow: false } };
  } catch {
    return { title: "論文 | Hubpedia | Hub v2", robots: { index: false, follow: false } };
  }
}

/*
 * 論文（2026-09-04、旦那様の「古いUIを出さない」）。
 * 本文は既存と同じ部品。複製すると必ずずれるので切り出して共有した。
 */
export default async function V2HubpediaPaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = await getHubpediaResearchWork(getHubD1(), id).catch(() => null);
  if (!work) notFound();
  return (
    <V2PanelPage panelOwnsHeading wide currentPath="/v2/hubpedia" title={work.title}>
      <HubpediaPaper work={work} />
    </V2PanelPage>
  );
}
