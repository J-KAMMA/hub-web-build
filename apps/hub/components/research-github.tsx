"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { parseGitHubRepositoryInput, type GitHubRepositoryOverview } from "@/lib/github-repository";
import { UiButton, UiField, UiInput } from "./ui/primitives";
import { V2ContentShare } from "./v2/v2-content-share";

export function ResearchGitHub() {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<GitHubRepositoryOverview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef({ serial: 0, controller: null as AbortController | null });
  const panel = useRef<HTMLElement>(null);
  const accepted = useRef(-1);
  const target = parseGitHubRepositoryInput(draft);
  function invalidate() {
    request.current.serial++;
    request.current.controller?.abort();
    panel.current?.querySelectorAll<HTMLAnchorElement>('.research-github-share a').forEach(link => link.removeAttribute('href'));
    setResult(null); setBusy(false); setError("");
  }
  useEffect(() => {
    const element = panel.current;
    window.addEventListener("hub-account-changed", invalidate);
    return () => {
      request.current.serial++;
      request.current.controller?.abort();
      window.removeEventListener("hub-account-changed", invalidate);
      element?.querySelectorAll<HTMLAnchorElement>('.research-github-share a').forEach(link => link.removeAttribute('href'));
    };
  }, []);
  async function read(event: FormEvent) {
    event.preventDefault(); invalidate();
    if (!target) { setError("owner/repository またはGitHubのリポジトリURLを入力してください。"); return; }
    const serial = request.current.serial, controller = new AbortController();
    request.current.controller = controller; setBusy(true);
    try {
      const response = await fetch(`/api/github/repository?repo=${encodeURIComponent(target.fullName)}`, {
        credentials: "omit", redirect: "error", cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
      });
      if (request.current.serial !== serial || controller.signal.aborted) return;
      if (response.status === 429) throw Error("GitHubの取得制限に達しました。時間をおいて再試行してください。");
      if (!response.ok) throw Error("公開情報を取得できませんでした。非公開リポジトリはGitHubで開いてください。");
      const data = await response.json() as GitHubRepositoryOverview;
      if (request.current.serial !== serial || controller.signal.aborted) return;
      if (!data.repository || data.repository.href !== target.href || data.repository.name !== target.fullName
        || !["ok", "partial"].includes(data.status)) throw Error("リポジトリの応答を確認できませんでした。");
      for (const key of ["issues", "pullRequests", "commits"] as const) {
        const items = data[key], status = data.categoryStatuses?.[key];
        if (!["ok", "unavailable", "rate_limited"].includes(status) || (status === "ok"
          ? !Array.isArray(items) || items.length > (key === "commits" ? 5 : 20) || items.some(item => !item
            || typeof item.title !== "string" || item.title.length > 300 || ("oid" in item
              ? key !== "commits" || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/.test(item.oid)
              : key === "commits" || !Number.isSafeInteger(item.number) || item.number < 1))
          : items !== null)) throw Error("リポジトリの応答を確認できませんでした。");
      }
      accepted.current = serial; setResult(data);
    } catch (cause) {
      if (request.current.serial === serial && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "取得できませんでした。");
    } finally {
      if (request.current.serial === serial) setBusy(false);
    }
  }
  const category = (key: "issues" | "pullRequests" | "commits", label: string) => {
    if (!result?.repository) return null;
    const items = result[key], status = result.categoryStatuses[key];
    const path = key === "issues" ? "issues" : key === "pullRequests" ? "pulls" : "commits";
    return <section aria-label={label}>
      <h3><a href={`${result.repository.href}/${path}`} target="_blank" rel="noopener noreferrer">{label}</a></h3>
      {status !== "ok" || !items ? <p role="status">{status === "rate_limited" ? "取得制限のため確認できません。" : "この一覧を取得できませんでした。"}</p>
        : !items.length ? <p>{key === "commits" ? "履歴はありません。" : "取得した最新20件に該当する項目はありません。"}</p>
          : <ul>{items.map(item => {
            const id = "oid" in item ? item.oid : String(item.number);
            const href = `${result.repository!.href}/${key === "commits" ? "commit" : key === "pullRequests" ? "pull" : "issues"}/${id}`;
            return <li key={id}><a href={href} target="_blank" rel="noopener noreferrer">{"oid" in item ? item.oid.slice(0, 7) : `#${item.number}`} {item.title}</a>{share(href, item.title)}</li>;
          })}</ul>}
    </section>;
  };
  function share(href: string, title: string) {
    return <span className="research-github-share" aria-label={`${title}を紹介`} onClickCapture={event => {
      if (accepted.current !== request.current.serial || !event.currentTarget.isConnected || !panel.current?.contains(event.currentTarget)) event.preventDefault();
    }}><V2ContentShare href={href} /></span>;
  }
  return <section id="github" className="research-github" ref={panel}>
    <h2>GitHub</h2>
    <p>公開リポジトリのコード、課題、変更提案と履歴を確認します。HubのGit履歴とは別の参照元です。</p>
    <form onSubmit={read}>
      <UiField label="GitHubリポジトリ" hint="例: microsoft/vscode"><UiInput value={draft} maxLength={180} autoCapitalize="none" spellCheck={false} onChange={event => { invalidate(); setDraft(event.target.value); }} /></UiField>
      <div className="research-state-actions">
        <UiButton type="submit" size="compact" pending={busy} pendingLabel="取得中…">公開情報を確認</UiButton>
        {target ? <a href={target.href} target="_blank" rel="noopener noreferrer">GitHubで開く</a> : null}
      </div>
    </form>
    <p className="research-github-note">入力したリポジトリ名をGitHubへ送ります。非公開の閲覧・編集・認証は「GitHubで開く」から行えます。</p>
    {error ? <p role="alert" className="research-error">{error}</p> : null}
    {result?.repository ? <div aria-live="polite">
      <h3><a href={result.repository.href} target="_blank" rel="noopener noreferrer">{result.repository.name}</a></h3>
      {share(result.repository.href, result.repository.name)}
      <p>{result.repository.description}</p><p>既定ブランチ: {result.repository.defaultBranch} · {result.repository.stars} stars</p>
      <p>課題と変更提案は更新順の最新20件、コミットは最新5件を表示します。</p>
      <div className="research-github-columns">{category("issues", "課題（Issues）")}{category("pullRequests", "変更提案（Pull requests）")}{category("commits", "変更履歴")}</div>
    </div> : null}
  </section>;
}
