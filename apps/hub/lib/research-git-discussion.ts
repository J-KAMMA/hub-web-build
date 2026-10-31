export type ResearchGitDiscussionSource = {projectId:string;projectTitle:string;oid:string;subject:string;href:string};
export function researchGitCommitHref(projectId:string,oid:string){return `/v2/research/${encodeURIComponent(projectId)}?commit=${oid}#git`;}
export function formatResearchGitDiscussionBody(source:ResearchGitDiscussionSource,body:string){return `${body.trim()}\n\n参照Git: ${source.projectTitle} / ${source.subject}\n${source.oid}\n${source.href}`;}
