/** Pure helpers for the Hub code hosting screens (no server imports, safe in client components). */

export const CODE_REPOSITORY_SOFT_LIMIT_BYTES = 1024 ** 3; // PLAN 3.8: 1 GB per repository
export const CODE_LICENSE_CHOICES = ["MIT", "Apache-2.0", "GPL-3.0-or-later", "AGPL-3.0-only", "MPL-2.0", "BSD-3-Clause", "CC0-1.0"] as const;

export function formatCodeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function codeCloneUrl(origin: string, owner: string, name: string): string {
  return `${origin.replace(/\/$/, "")}/code/git/${encodeURIComponent(owner)}/${encodeURIComponent(name)}.git`;
}

export function codeRepositoryHref(owner: string, name: string): string {
  return `/v2/code/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** Shell commands shown on the repository page. The token is typed at the password prompt, never put in the URL. */
export function codeSetupCommands(cloneUrl: string, owner: string, defaultBranch: string): { clone: string; push: string } {
  return {
    clone: `git clone ${cloneUrl}`,
    push: [`git remote add hub ${cloneUrl}`, `git push -u hub ${defaultBranch}`].join("\n"),
  };
}

/** Security research PoC code is allowed only in a public repository with a description (PLAN Q8). */
export function codeCreateProblem(input: { name: string; description: string; visibility: "public" | "private"; securityPoc: boolean }): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.name) || input.name.toLowerCase().endsWith(".git")) {
    return "名前は英数字と . _ - の100文字以内で、英数字から始めてください。";
  }
  if (input.description.length > 500) return "説明は500文字以内で入力してください。";
  if (input.securityPoc && (input.visibility !== "public" || !input.description.trim())) {
    return "セキュリティ研究の概念実証は、説明を付けた公開リポジトリにだけ置けます。";
  }
  return null;
}

export function codeTokenState(token: { revokedAt: string | null; expiresAt: string }, now = new Date()): "active" | "revoked" | "expired" {
  if (token.revokedAt) return "revoked";
  return Date.parse(token.expiresAt) <= now.getTime() ? "expired" : "active";
}

/** GitHub-style "updated" text: 分前 / 時間前 / 日前 up to 30 days, then the date. Future or invalid times fall back to the date. */
export function formatCodeUpdated(iso: string, now = new Date()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso.slice(0, 10);
  const minutes = Math.floor((now.getTime() - time) / 60_000);
  if (minutes < 0) return iso.slice(0, 10);
  if (minutes < 1) return "たった今更新";
  if (minutes < 60) return `${minutes}分前に更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前に更新`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days}日前に更新`;
  return `${iso.slice(0, 10)} に更新`;
}

/** Filter already-loaded repositories by owner, name or description (case-insensitive, NFKC). */
export function filterCodeRepositories<T extends { owner: string; name: string; description: string }>(repositories: readonly T[], query: string): T[] {
  const needle = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  if (!needle) return [...repositories];
  return repositories.filter((repository) => `${repository.owner}/${repository.name} ${repository.description}`.normalize("NFKC").toLocaleLowerCase("ja").includes(needle));
}
