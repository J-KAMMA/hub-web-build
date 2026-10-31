import type { Metadata } from "next";

import { ResearchIndex } from "@/components/research-workspace";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listResearchProjects } from "@/lib/server/d1-research";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../v2-research-list.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "研究 | Hub v2" };

/* 研究の一覧。既存の ResearchIndex（主張・根拠・来歴の単位）をそのまま。部品が h1 を持つ。 */
export default async function V2ResearchPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const database = getOptionalHubD1();
  let projects: Awaited<ReturnType<typeof listResearchProjects>> = [];
  let unavailable = false;
  try {
    if (database) projects = await listResearchProjects(database, shell.currentProfile.id || undefined);
    else unavailable = true;
  } catch {
    unavailable = true;
  }
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const library = await loadViewerLibrary(shell.currentProfile.id, "research", japanese);
  return (
    <V2Shell skin="luxe"
      currentPath="/v2/research"
      profile={shell.currentProfile}
      items={items}
      directory={<V2LibraryColumn data={library} signedIn={Boolean(shell.currentProfile.id)} japanese={japanese} next="/v2/research" />}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <ResearchIndex projects={projects} signedIn={Boolean(shell.currentProfile.id)} unavailable={unavailable} basePath="/v2/research" v2 />
    </V2Shell>
  );
}
