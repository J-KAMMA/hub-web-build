import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ResearchProjectUnavailable, ResearchProjectWorkspace } from "@/components/research-workspace";
import { V2HubpediaCitations } from "@/components/v2/v2-hubpedia-citations";
import { V2ResearchTokenEntry } from "@/components/v2/v2-research-token-entry";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getResearchProject, listResearchObjects } from "@/lib/server/d1-research";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { loadResearchVersionCitations } from "@/lib/server/hubpedia-citations";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { V2ResearchFundReports } from "@/components/v2/v2-research-fund-reports";
import { listResearchFundReports } from "@/lib/server/research-fund-reports";
import { getResearchProjectToken } from "@/lib/server/research-project-token";
import { researchTokenEnabled } from "@/lib/server/research-token-flag";
import { researchSourceReturn } from "@/lib/research-discovery";

import "../../v2.css";
import "../../redesign-media.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "研究プロジェクト | Hub v2" };

/* 研究プロジェクトの作業場。既存の ResearchProjectWorkspace（主張・根拠・来歴）をそのまま。 */
export default async function V2ResearchProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ document?: string; version?: string; commit?: string | string[]; base?: string | string[]; gitProposal?: string | string[]; from?: string | string[] }> }) {
  const [{ projectId }, viewer] = await Promise.all([params, getHubViewer()]);
  const database = getOptionalHubD1();
  if (!database) {
    return <V2PanelPage currentPath="/v2/research" title="研究"><ResearchProjectUnavailable basePath="/v2/research" /></V2PanelPage>;
  }
  let project: Awaited<ReturnType<typeof getResearchProject>>;
  try {
    project = await getResearchProject(database, projectId, viewer?.id);
  } catch {
    return <V2PanelPage currentPath="/v2/research" title="研究"><ResearchProjectUnavailable basePath="/v2/research" /></V2PanelPage>;
  }
  if (!project) notFound();
  let objects: Awaited<ReturnType<typeof listResearchObjects>>["objects"] = [];
  let relations: Awaited<ReturnType<typeof listResearchObjects>>["relations"] = [];
  let unavailable = false;
  try {
    ({ objects, relations } = await listResearchObjects(database, project.id, viewer?.id));
  } catch {
    unavailable = true;
  }
  const canEdit = project.ownerProfileId === viewer?.id;
  /* Token entry and fund reports are off until the DeSci legal review (HUB_RESEARCH_TOKEN_ENABLED); nothing is read while off. */
  const tokenEnabled = researchTokenEnabled();
  const projectToken = tokenEnabled ? await getResearchProjectToken(database, project.id, viewer?.id).catch(() => null) : null;
  const fundReports = tokenEnabled ? await listResearchFundReports(database, project.id, viewer?.id).catch(() => []) : [];
  const query = await searchParams;
  const citations = await loadResearchVersionCitations(typeof query.document === "string" ? query.document : undefined, typeof query.version === "string" ? query.version : undefined);
  const source = researchSourceReturn(query.from);
  const sections = [
    ["overview", "概要"], ["workspace", "文書・コード"], ["references", "資料・作品・議論"],
    ["pdfs", "論文PDF"], ["git", "Gitリポジトリ"], ["github", "GitHub"], ...(tokenEnabled && (canEdit || fundReports.length > 0) ? [["fund-reports", "資金の使い道"]] : []), ["objects", "研究成果"], ["relations", "主張と根拠"],
    ...(canEdit ? [["register", "成果・関係の登録"]] : []),
  ];
  const secondary = new Set(["pdfs", "git", "github"]);
  const tab = ([id, label]: string[]) => <li key={id}><a className="v2-nav__item" href={`#${id}`}><span className="v2-nav__label">{label}</span></a></li>;
  const directory = <>
    <ul className="v2-nav__list">{sections.slice(0, 3).map(tab)}</ul>
    <details className="v2-filter-disclosure v2-filter-disclosure--list">
      <summary>その他</summary>
      <ul className="v2-nav__list">{sections.filter(([id]) => secondary.has(id)).map(tab)}</ul>
    </details>
    <ul className="v2-nav__list">{sections.slice(6).map(tab)}</ul>
  </>;
  return (
    <V2PanelPage panelOwnsHeading currentPath="/v2/research" title={project.title} directoryTitle={project.title} directory={directory}>
      {source ? <p className="v2-note"><Link href={source.href} prefetch={false}>元の{source.label}へ戻る</Link></p> : null}
      <ResearchProjectWorkspace project={project} objects={objects} relations={relations} canEdit={canEdit} signedIn={!!viewer} viewerId={viewer?.id} initialDocument={typeof query.document === 'string' ? query.document : ''} initialVersion={query.version === undefined ? '' : typeof query.version === 'string' ? query.version : 'invalid'} initialCommit={query.commit === undefined ? '' : typeof query.commit === 'string' ? query.commit : 'invalid'} initialBase={query.base === undefined ? '' : typeof query.base === 'string' ? query.base : 'invalid'} initialGitProposal={query.gitProposal === undefined ? '' : typeof query.gitProposal === 'string' ? query.gitProposal : 'invalid'} unavailable={unavailable} basePath="/v2/research" showNavigation={false} />
      {tokenEnabled ? <V2ResearchTokenEntry projectId={project.id} token={projectToken} canEdit={canEdit} /> : null}
      {tokenEnabled ? <V2ResearchFundReports projectId={project.id} reports={fundReports} canEdit={canEdit} /> : null}
      <V2HubpediaCitations citations={citations} japanese />
    </V2PanelPage>
  );
}
