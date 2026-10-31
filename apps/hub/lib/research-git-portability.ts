import type {ResearchGitManagementInfo} from './research-git-management';

export function researchGitBundleUrl(info: ResearchGitManagementInfo): string | null {
  if (!info.projectPublic || info.repository?.visibility !== 'public' || !info.repository.url || !/^rp_[a-f0-9]{32}$(?![\s\S])/.test(info.projectId)) return null;
  try {
    const raw = info.repository.url;
    if (raw.length > 2048 || /[\x00-\x20\x7f\\]/.test(raw)) return null;
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash || url.pathname !== `/git/${info.projectId}.git` ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return `${url.origin}/v1/repositories/${info.projectId}/bundle`;
  } catch { return null; }
}
