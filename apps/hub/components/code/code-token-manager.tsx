"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { codeTokenState } from "@/lib/code-ui";
import { CodeCopyBlock } from "./code-copy-block";

type TokenRow = { id: string; repoId: string | null; scope: "read" | "write"; label: string; expiresAt: string; revokedAt: string | null; createdAt: string };
type RepoOption = { id: string; owner: string; name: string };

const STATE_LABEL = { active: "有効", revoked: "取り消し済み", expired: "期限切れ" } as const;

async function readJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

export function CodeTokenManager({ initialTokens, initialRepositories }: { initialTokens?: TokenRow[]; initialRepositories?: RepoOption[] } = {}) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens ?? []);
  const [repos, setRepos] = useState<RepoOption[]>(initialRepositories ?? []);
  const [loaded, setLoaded] = useState(Boolean(initialTokens));
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [repoId, setRepoId] = useState("");
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const [tokenResponse, repoResponse] = await Promise.all([fetch("/api/code/tokens"), fetch("/api/code/repos")]);
      if (tokenResponse.status === 401) {
        setError("ログインするとトークンを管理できます。");
        return;
      }
      const tokenPayload = await readJson<{ tokens?: TokenRow[] }>(tokenResponse);
      const repoPayload = await readJson<{ repositories?: RepoOption[] }>(repoResponse);
      if (!tokenResponse.ok || !tokenPayload?.tokens) {
        setError("トークンを読み込めませんでした。");
        return;
      }
      setTokens(tokenPayload.tokens);
      setRepos(repoPayload?.repositories ?? []);
    } catch {
      setError("通信できませんでした。");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!initialTokens) void load();
  }, [initialTokens, load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/code/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, expiresInDays: days, label: label.trim(), repoId: repoId || null }),
      });
      const payload = await readJson<{ token?: string; tokenInfo?: TokenRow; error?: string }>(response);
      if (response.ok && payload?.token && payload.tokenInfo) {
        setIssued(payload.token);
        setTokens((current) => [payload.tokenInfo as TokenRow, ...current]);
        setLabel("");
      } else {
        setError(payload?.error || "トークンを作れませんでした。");
      }
    } catch {
      setError("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      const response = await fetch(`/api/code/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (response.ok) setTokens((current) => current.map((token) => (token.id === id ? { ...token, revokedAt: new Date().toISOString() } : token)));
      else setError("取り消せませんでした。");
    } catch {
      setError("通信できませんでした。");
    }
  }

  const repoName = (id: string | null) => {
    if (!id) return "自分の全リポジトリ";
    const repo = repos.find((entry) => entry.id === id);
    return repo ? `${repo.owner}/${repo.name}` : "指定のリポジトリ";
  };

  return (
    <div className="hub-code__stack">
      {issued ? (
        <section className="hub-code__panel hub-code__panel--notice" aria-live="polite">
          <h2 className="hub-code__h2">トークンを作りました</h2>
          <p className="hub-code__note">この画面を閉じると、もう一度は表示されません。今コピーして、安全な場所に保管してください。</p>
          <CodeCopyBlock label="トークン" value={issued} />
          <div className="hub-code__actions"><button type="button" className="hub-code__button" onClick={() => setIssued(null)}>保管しました</button></div>
        </section>
      ) : null}
      <section className="hub-code__panel">
        <h2 className="hub-code__h2">新しいトークン</h2>
        <form className="hub-code__form" onSubmit={(event) => void create(event)}>
          <label className="hub-code__field">
            <span>名前（任意）</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={100} placeholder="例：仕事用のPC" />
          </label>
          <label className="hub-code__field">
            <span>対象</span>
            <select value={repoId} onChange={(event) => setRepoId(event.target.value)}>
              <option value="">自分の全リポジトリ</option>
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.owner}/{repo.name}</option>)}
            </select>
          </label>
          <label className="hub-code__field">
            <span>権限</span>
            <select value={scope} onChange={(event) => setScope(event.target.value === "write" ? "write" : "read")}>
              <option value="read">読み取り（clone と pull）</option>
              <option value="write">書き込み（push もできる）</option>
            </select>
          </label>
          <label className="hub-code__field">
            <span>期限</span>
            <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {[7, 30, 60, 90].map((value) => <option key={value} value={value}>{value}日</option>)}
            </select>
            <small>最長90日です。期限が切れたら作り直します。</small>
          </label>
          <div className="hub-code__actions"><button type="submit" className="hub-code__button hub-code__button--primary" disabled={busy}>{busy ? "作成しています" : "トークンを作る"}</button></div>
        </form>
      </section>
      {error ? <p className="hub-code__error" role="alert">{error}</p> : null}
      <section className="hub-code__panel">
        <h2 className="hub-code__h2">発行済みのトークン</h2>
        {!loaded ? <p className="hub-code__empty">読み込んでいます</p> : tokens.length === 0 ? <p className="hub-code__empty">トークンはまだありません。</p> : (
          <ul className="hub-code__list">
            {tokens.map((token) => {
              const state = codeTokenState(token);
              return (
                <li key={token.id} className="hub-code__item">
                  <div className="hub-code__item-head">
                    <span className="hub-code__item-name">{token.label || "名前なし"}</span>
                    <span className={`hub-code__badge${state === "active" ? "" : " hub-code__badge--quiet"}`}>{STATE_LABEL[state]}</span>
                  </div>
                  <p className="hub-code__meta">{repoName(token.repoId)}・{token.scope === "write" ? "書き込み" : "読み取り"}・期限 {token.expiresAt.slice(0, 10)}</p>
                  {state === "active" ? <div className="hub-code__actions"><button type="button" className="hub-code__button hub-code__button--danger" onClick={() => void revoke(token.id)}>取り消す</button></div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
