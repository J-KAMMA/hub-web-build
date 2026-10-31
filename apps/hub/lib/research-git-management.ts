export type ResearchGitScope = 'read' | 'write';
export type ResearchGitVisibility = 'public' | 'confidential';
export type ResearchGitManagementInfo = {
  projectId: string; viewerId: string | null; canManage: boolean; projectPublic: boolean; snapshot: string;
  repository: { visibility: ResearchGitVisibility; url: string | null } | null;
  tokens: { id: string; scope: ResearchGitScope; expiresAt: string }[];
};
export type ResearchGitManagementInput = {snapshot: string} & (
  {action: 'create'} | {action: 'visibility'; visibility: ResearchGitVisibility} |
  {action: 'revoke'; id: string} | {action: 'token'; scope: ResearchGitScope; requestId: string}
);
export type ResearchGitManagementResult = {
  projectId: string; action: ResearchGitManagementInput['action']; data: ResearchGitManagementInfo; replayed: boolean;
  id?: string; scope?: ResearchGitScope; expiresAt?: string; active?: boolean; token?: string; requestId?: string;
};
export const RESEARCH_GIT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/;
const projectIdPattern = /^rp_[a-f0-9]{32}$(?![\s\S])/;
const profileIdPattern = /^[A-Za-z0-9_-]{1,100}$(?![\s\S])/;
const hashPattern = /^[a-f0-9]{64}$(?![\s\S])/;
const scope = (value:unknown) => value === 'read' || value === 'write';
const visibility = (value:unknown) => value === 'public' || value === 'confidential';
const fail = (): never => {throw new Error('Gitの応答を確認できませんでした。もう一度読み込んでください。');};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$(?![\s\S])/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
}
function cloneUrl(value: unknown, projectId: string): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f\\]/.test(value)) return false;
  try {const url = new URL(value); return !url.username && !url.password && !url.search && !url.hash && url.pathname === `/git/${projectId}.git` && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));} catch {return false;}
}
export function parseResearchGitManagementInfo(value: unknown, projectId: string): ResearchGitManagementInfo {
  if (!projectIdPattern.test(projectId) || !object(value) || !keys(value,['projectId','viewerId','canManage','projectPublic','snapshot','repository','tokens']) || value.projectId !== projectId || !(value.viewerId === null || typeof value.viewerId === 'string' && profileIdPattern.test(value.viewerId)) || typeof value.canManage !== 'boolean' || typeof value.projectPublic !== 'boolean' || typeof value.snapshot !== 'string' || !hashPattern.test(value.snapshot) || value.canManage && !value.viewerId || !Array.isArray(value.tokens) || value.tokens.length > 20) return fail();
  if (value.repository !== null && (!object(value.repository) || !keys(value.repository,['visibility','url']) || !visibility(value.repository.visibility) || !cloneUrl(value.repository.url,projectId))) return fail();
  if (!value.canManage && value.tokens.length || !value.repository && value.tokens.length) return fail();
  const ids = new Set<string>();
  for (const token of value.tokens) {if (!object(token) || !keys(token,['id','scope','expiresAt']) || typeof token.id !== 'string' || !RESEARCH_GIT_REQUEST_ID.test(token.id) || ids.has(token.id) || !scope(token.scope) || !timestamp(token.expiresAt)) return fail(); ids.add(token.id);}
  return value as unknown as ResearchGitManagementInfo;
}
export function parseResearchGitManagementResult(value: unknown, projectId: string, body: ResearchGitManagementInput): ResearchGitManagementResult {
  const tokenKeys = body.action === 'token' ? ['id','scope','expiresAt','active','token','requestId'] : [];
  if (!object(value) || !keys(value,['projectId','action','data','replayed'],tokenKeys) || value.projectId !== projectId || value.action !== body.action || typeof value.replayed !== 'boolean') return fail();
  const data = parseResearchGitManagementInfo(value.data, projectId);
  if (!data.canManage || !data.repository) return fail();
  if (body.action === 'visibility' && data.repository.visibility !== body.visibility || body.action === 'revoke' && data.tokens.some(token => token.id === body.id)) return fail();
  if (body.action === 'token') {
    if (value.id !== body.requestId || value.requestId !== body.requestId || value.scope !== body.scope || !timestamp(value.expiresAt) || typeof value.active !== 'boolean' || value.token !== undefined && (value.replayed || !value.active || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$(?![\s\S])/.test(value.token))) return fail();
    const current = data.tokens.find(token => token.id === body.requestId);
    if (value.active && (!current || current.scope !== body.scope || current.expiresAt !== value.expiresAt) || !value.active && current || !value.replayed && !value.token) return fail();
  }
  return value as unknown as ResearchGitManagementResult;
}
