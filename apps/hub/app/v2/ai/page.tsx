import type { Metadata } from "next";

import { V2AiWorkspaceHost } from "@/components/v2/v2-ai-workspace";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../v2.css";
import "../v2-luxe.css";
import "../v2-luxe-account.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI | Hub v2" };

/* 同じAI作業画面を中央へ移す。右列は出さない（画面が要る）。
   ?ai_prompt= はデスクトップのブラウザ窓が「このページをAIへ送る」で開く入口。 */
export default async function V2AiPage({ searchParams }: { searchParams: Promise<{ ai_prompt?: string | string[] }> }) {
  const raw = (await searchParams).ai_prompt;
  const prompt = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 4000);
  const { currentProfile } = await getAppShellData();
  return (
    <V2PanelPage skin="luxe" wide currentPath="/v2/ai" title="AI">
      <V2AiWorkspaceHost kind="main" scope={`${Boolean(currentProfile.id)}:${currentProfile.id}`} initialPrompt={prompt || undefined} />
    </V2PanelPage>
  );
}
