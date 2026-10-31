import "server-only";

import { parseGitHubRepositoryInput, type GitHubRepositoryCommit, type GitHubRepositoryItem,
  type GitHubRepositoryOverview, type GitHubRepositoryTarget, type GitHubReadStatus } from "@/lib/github-repository";

type ReadResult = { status: "ok"; data: unknown } | { status: Exclude<GitHubReadStatus, "ok"> };
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const sameLink = (value: unknown, href: string) => typeof value === "string" && value.toLowerCase() === href;
const unavailable = (status: "unavailable" | "rate_limited" = "unavailable"): GitHubRepositoryOverview => ({
  status, repository: null, issues: null, pullRequests: null, commits: null,
  categoryStatuses: { issues: status, pullRequests: status, commits: status },
});
const text = (value: unknown, limit: number) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gu, "[redacted]").trim().slice(0, limit) : null;

async function readPublicJson(path: string, limit: number, signal?: AbortSignal): Promise<ReadResult> {
  try {
    const response = await fetch(`https://api.github.com/repos/${path}`, {
      method: "GET", credentials: "omit", redirect: "manual", cache: "no-store",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "JKamma-Hub-PublicRepository" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (response.status === 429 || (response.status === 403
      && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) return { status: "rate_limited" };
    if (response.status !== 200 || response.redirected || !response.body
      || !/^application\/(?:json|[^;\s]+\+json)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) return { status: "unavailable" };
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) return { status: "unavailable" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); return { status: "unavailable" }; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: "ok", data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch { return { status: "unavailable" }; }
}

function metadata(value: unknown, target: GitHubRepositoryTarget) {
  const item = object(value);
  const parsed = parseGitHubRepositoryInput(item?.full_name);
  const description = item?.description === null ? "" : text(item?.description, 1_000);
  const defaultBranch = text(item?.default_branch, 128);
  if (!item || item.private !== false || !parsed || parsed.fullName !== target.fullName || !sameLink(item.html_url, target.href)
    || description === null || !defaultBranch
    || !Number.isSafeInteger(item.stargazers_count) || Number(item.stargazers_count) < 0) return null;
  return { name: target.fullName, href: target.href, description, defaultBranch, stars: Number(item.stargazers_count) };
}

function issues(value: unknown, target: GitHubRepositoryTarget) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const issues: GitHubRepositoryItem[] = [];
  const pullRequests: GitHubRepositoryItem[] = [];
  for (const raw of value) {
    const item = object(raw);
    const title = text(item?.title, 300);
    const pull = item && Object.hasOwn(item, "pull_request");
    const href = `${target.href}/${pull ? "pull" : "issues"}/${item?.number}`;
    if (!item || !positiveInteger(item.number) || !title || item.state !== "open" || !sameLink(item.html_url, href)
      || typeof item.updated_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(item.updated_at)
      || !Number.isFinite(Date.parse(item.updated_at)) || (pull && !object(item.pull_request))) return null;
    (pull ? pullRequests : issues).push({ number: item.number, title, href });
  }
  return { issues, pullRequests };
}

function commits(value: unknown, target: GitHubRepositoryTarget): GitHubRepositoryCommit[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const result: GitHubRepositoryCommit[] = [];
  for (const raw of value) {
    const item = object(raw);
    const commit = object(item?.commit);
    const title = typeof commit?.message === "string" ? text(commit.message.split(/\r?\n/, 1)[0], 300) : null;
    const href = `${target.href}/commit/${item?.sha}`;
    if (!item || typeof item.sha !== "string" || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/.test(item.sha)
      || !sameLink(item.html_url, href) || !title) return null;
    result.push({ oid: item.sha, title, href });
  }
  return result;
}

export async function readGitHubPublicRepository(target: GitHubRepositoryTarget, signal?: AbortSignal): Promise<GitHubRepositoryOverview> {
  // Validate again at the server boundary; a caller cannot select another host or path.
  const checked = parseGitHubRepositoryInput(target.fullName);
  if (!checked || checked.owner !== target.owner || checked.repo !== target.repo || checked.href !== target.href) return unavailable();
  const initial = await readPublicJson(checked.fullName, 65_536, signal);
  if (initial.status !== "ok") return unavailable(initial.status);
  const repository = metadata(initial.data, checked);
  if (!repository) return unavailable();
  const [issueRead, commitRead] = await Promise.all([
    readPublicJson(`${checked.fullName}/issues?state=open&sort=updated&direction=desc&per_page=20`, 262_144, signal),
    readPublicJson(`${checked.fullName}/commits?per_page=5`, 131_072, signal),
  ]);
  const issueData = issueRead.status === "ok" ? issues(issueRead.data, checked) : null;
  const commitData = commitRead.status === "ok" ? commits(commitRead.data, checked) : null;
  const categoryStatuses = {
    issues: issueRead.status === "ok" ? issueData ? "ok" : "unavailable" : issueRead.status,
    pullRequests: issueRead.status === "ok" ? issueData ? "ok" : "unavailable" : issueRead.status,
    commits: commitRead.status === "ok" ? commitData ? "ok" : "unavailable" : commitRead.status,
  } as const;
  return { status: categoryStatuses.issues === "ok" && categoryStatuses.commits === "ok" ? "ok" : "partial",
    repository, issues: issueData?.issues ?? null, pullRequests: issueData?.pullRequests ?? null, commits: commitData, categoryStatuses };
}
