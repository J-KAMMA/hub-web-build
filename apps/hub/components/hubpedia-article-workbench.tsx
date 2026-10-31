"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import styles from "./hubpedia-article-workbench.module.css";

type Discussion = {
  id: string;
  body: string;
  authorHandle: string;
  createdAt: string;
};

type Revision = {
  id: string;
  revisionNumber: number;
  editSummary: string;
  authorHandle?: string | null;
  createdAt: string;
};

type Audit = {
  action: string;
  targetId?: string | null;
  createdAt: string;
};

type RelatedThread = {
  threadId: string;
  title: string;
  status: string;
  postCount: number;
  updatedAt: string;
};

type Tab = "discussion" | "correction" | "history";
type ResourceState = "loading" | "ready" | "error";

const correctionPrefix = "【訂正提案】";

export function HubpediaArticleWorkbench({ slug }: { slug: string }) {
  const [tab, setTab] = useState<Tab>("discussion");
  const [comments, setComments] = useState<Discussion[]>([]);
  const [relatedThreads, setRelatedThreads] = useState<RelatedThread[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [watching, setWatching] = useState(false);
  const [watchAvailable, setWatchAvailable] = useState(true);
  const [body, setBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [threadReference, setThreadReference] = useState("");
  const [status, setStatus] = useState("読み込み中…");
  const [busy, setBusy] = useState(false);
  const [resourceState, setResourceState] = useState({
    discussion: "loading" as ResourceState,
    relatedThreads: "loading" as ResourceState,
    history: "loading" as ResourceState,
    watch: "loading" as ResourceState,
  });
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const base = `/api/hubpedia/articles/${encodeURIComponent(slug)}`;
    setResourceState({
      discussion: "loading",
      relatedThreads: "loading",
      history: "loading",
      watch: "loading",
    });
    setStatus("読み込み中…");

    const settled = await Promise.allSettled([
      fetch(`${base}/discussion`, { cache: "no-store" }),
      fetch(`${base}/discussions`, { cache: "no-store" }),
      fetch(`${base}/history`, { cache: "no-store" }),
      fetch(`${base}/watch`, { cache: "no-store" }),
    ]);
    if (version !== loadVersion.current) return;

    const nextState = {
      discussion: "error" as ResourceState,
      relatedThreads: "error" as ResourceState,
      history: "error" as ResourceState,
      watch: "error" as ResourceState,
    };
    const responseAt = (index: number) => {
      const result = settled[index];
      return result.status === "fulfilled" ? result.value : null;
    };

    const discussionResponse = responseAt(0);
    if (discussionResponse?.ok) {
      try {
        const payload = await discussionResponse.json() as {
          comments?: Discussion[];
        };
        if (version !== loadVersion.current) return;
        setComments(payload.comments ?? []);
        nextState.discussion = "ready";
      } catch {
        nextState.discussion = "error";
      }
    }

    const relatedThreadsResponse = responseAt(1);
    if (relatedThreadsResponse?.ok) {
      try {
        const payload = await relatedThreadsResponse.json() as {
          discussions?: RelatedThread[];
        };
        if (version !== loadVersion.current) return;
        setRelatedThreads(payload.discussions ?? []);
        nextState.relatedThreads = "ready";
      } catch {
        nextState.relatedThreads = "error";
      }
    }

    const historyResponse = responseAt(2);
    if (historyResponse?.ok) {
      try {
        const payload = await historyResponse.json() as {
          revisions?: Revision[];
          audits?: Audit[];
        };
        if (version !== loadVersion.current) return;
        setRevisions(payload.revisions ?? []);
        setAudits(payload.audits ?? []);
        nextState.history = "ready";
      } catch {
        nextState.history = "error";
      }
    }

    const watchResponse = responseAt(3);
    if (watchResponse?.ok) {
      try {
        const payload = await watchResponse.json() as { watching?: boolean };
        if (version !== loadVersion.current) return;
        setWatching(Boolean(payload.watching));
        setWatchAvailable(true);
        nextState.watch = "ready";
      } catch {
        nextState.watch = "error";
      }
    } else if (watchResponse?.status === 401) {
      setWatchAvailable(false);
      nextState.watch = "ready";
    }

    setResourceState(nextState);
    const hasError = Object.values(nextState).some((state) => state === "error");
    setStatus(
      hasError
        ? "一部の情報を読み込めませんでした。表示中の内容を確認し、再読み込みしてください。"
        : "",
    );
  }, [slug]);

  useEffect(() => {
    void load().catch(() => {
      setResourceState({
        discussion: "error",
        relatedThreads: "error",
        history: "error",
        watch: "error",
      });
      setStatus("情報を読み込めませんでした。");
    });
  }, [load]);

  const toggleWatch = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/hubpedia/articles/${encodeURIComponent(slug)}/watch`, {
        method: watching ? "DELETE" : "PUT",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setWatchAvailable(false);
        setStatus("更新通知を使うにはログインしてください。");
        return;
      }
      if (!response.ok) {
        setStatus("更新通知の設定を変更できませんでした。");
        return;
      }
      setWatching(!watching);
      setStatus(watching ? "更新通知を解除しました。" : "記事の更新を通知します。");
    } catch {
      setStatus("更新通知の設定を変更できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const trimmedBody = body.trim();
    if (trimmedBody.length < 2) return;
    setBusy(true);
    const correctionBody = tab === "correction"
      ? `${correctionPrefix}\n${trimmedBody}${sourceUrl.trim() ? `\n出典: ${sourceUrl.trim()}` : ""}`
      : trimmedBody;
    try {
      const response = await fetch(`/api/hubpedia/articles/${encodeURIComponent(slug)}/discussion`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: correctionBody }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setStatus(payload.error ?? "投稿できませんでした。");
        return;
      }
      setBody("");
      setSourceUrl("");
      setStatus(tab === "correction" ? "訂正提案を投稿しました。" : "議論へ投稿しました。");
      await load();
    } catch {
      setStatus("投稿できませんでした。入力内容は保持されています。");
    } finally {
      setBusy(false);
    }
  };

  const linkThread = async () => {
    const threadId = threadReference
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .at(-1) ?? "";
    if (!threadId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/hubpedia/articles/${encodeURIComponent(slug)}/discussions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setStatus(payload.error ?? "スレッドを関連付けできませんでした。");
        return;
      }
      setThreadReference("");
      setStatus("記事にスレッドを関連付けました。");
      await load();
    } catch {
      setStatus("スレッドを関連付けできませんでした。入力内容は保持されています。");
    } finally {
      setBusy(false);
    }
  };

  const discussionItems = comments.filter((item) => !item.body.startsWith(correctionPrefix));
  const correctionItems = comments.filter((item) => item.body.startsWith(correctionPrefix));
  const activeDiscussionState = resourceState.discussion;
  const hasLoadError = Object.values(resourceState).some(
    (state) => state === "error",
  );
  const statusIsError =
    status.includes("できません") || status.includes("読み込めません");

  return (
    <section className={styles.workbench} aria-label="記事の議論と更新">
      <nav className={styles.tabs} role="tablist" aria-label="記事の共同作業">
        {([
          ["discussion", "議論"],
          ["correction", "訂正提案"],
          ["history", "履歴・監査"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab !== "history" ? (
        <div className={styles.panel} role="tabpanel">
          <div className={styles.toolbar}>
            <h2>{tab === "correction" ? "訂正を提案" : "記事について議論"}</h2>
            {watchAvailable ? (
              <button className={styles.watch} type="button" disabled={busy} onClick={() => void toggleWatch()}>
                {watching ? "更新通知を解除" : "更新を通知"}
              </button>
            ) : null}
          </div>
          <div className={styles.composer}>
            <label>
              {tab === "correction" ? "誤りと、正しいと考える内容" : "コメント"}
              <textarea
                value={body}
                maxLength={5000}
                onChange={(event) => setBody(event.target.value)}
                placeholder={tab === "correction" ? "対象箇所、訂正内容、理由を記載してください" : "根拠や論点を添えて投稿してください"}
              />
            </label>
            {tab === "correction" ? (
              <label>
                根拠となる公開URL（任意）
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://"
                />
              </label>
            ) : null}
            <div className={styles.composerActions}>
              <span className={styles.status}>記事本文は直接変更されず、公開の検討記録として残ります。</span>
              <button className={styles.primary} type="button" disabled={busy || body.trim().length < 2} onClick={() => void submit()}>
                投稿
              </button>
            </div>
          </div>
          <div className={styles.list}>
            {(tab === "correction" ? correctionItems : discussionItems).map((item) => (
              <article className={styles.item} key={item.id}>
                <div className={styles.itemHeader}>
                  <strong>@{item.authorHandle}</strong>
                  <small>{new Date(item.createdAt).toLocaleString("ja-JP")}</small>
                </div>
                {tab === "correction" ? <span className={styles.kind}>訂正提案</span> : null}
                <p>{item.body.replace(`${correctionPrefix}\n`, "")}</p>
              </article>
            ))}
            {activeDiscussionState === "loading" ? (
              <p className={styles.empty}>投稿を読み込んでいます…</p>
            ) : null}
            {activeDiscussionState === "error" &&
            (tab === "correction" ? correctionItems : discussionItems).length === 0 ? (
              <p className={styles.empty}>投稿を表示できません。</p>
            ) : null}
            {activeDiscussionState === "ready" &&
            (tab === "correction" ? correctionItems : discussionItems).length === 0 ? (
              <p className={styles.empty}>まだ投稿はありません。</p>
            ) : null}
          </div>
          {tab === "discussion" ? (
            <section className={styles.related} aria-labelledby={`related-threads-${slug}`}>
              <div className={styles.relatedHeader}>
                <div>
                  <h2 id={`related-threads-${slug}`}>関連スレッド</h2>
                  <p>記事を根拠として扱わず、議論と検証の場を分けて表示します。</p>
                </div>
                <span>{relatedThreads.length ? `${relatedThreads.length}件` : null}</span>
              </div>
              {relatedThreads.length ? (
                <div className={styles.relatedList}>
                  {relatedThreads.map((thread) => (
                    <a className={styles.relatedLink} href={`/threads/${encodeURIComponent(thread.threadId)}`} key={thread.threadId}>
                      <span>
                        <strong>{thread.title}</strong>
                        <small>{thread.postCount}件の投稿</small>
                      </span>
                      <span aria-hidden="true">→</span>
                    </a>
                  ))}
                </div>
              ) : resourceState.relatedThreads === "loading" ? (
                <p className={styles.empty}>関連スレッドを読み込んでいます…</p>
              ) : resourceState.relatedThreads === "error" ? (
                <p className={styles.empty}>関連スレッドを表示できません。</p>
              ) : (
                <p className={styles.empty}>関連スレッドはまだありません。</p>
              )}
              <div className={styles.linkForm}>
                <label htmlFor={`thread-reference-${slug}`}>自分の公開スレッドを関連付ける</label>
                <div>
                  <input
                    id={`thread-reference-${slug}`}
                    value={threadReference}
                    onChange={(event) => setThreadReference(event.target.value)}
                    placeholder="スレッドURLまたはID"
                  />
                  <button className={styles.secondary} type="button" disabled={busy || !threadReference.trim()} onClick={() => void linkThread()}>
                    関連付け
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <div className={styles.panel} role="tabpanel">
          <div className={styles.toolbar}>
            <h2>更新履歴と監査記録</h2>
            {watchAvailable ? (
              <button className={styles.watch} type="button" disabled={busy} onClick={() => void toggleWatch()}>
                {watching ? "更新通知を解除" : "更新を通知"}
              </button>
            ) : null}
          </div>
          <div className={styles.list}>
            {revisions.map((revision) => (
              <article className={styles.item} key={revision.id}>
                <div className={styles.itemHeader}>
                  <strong>版 {revision.revisionNumber}</strong>
                  <small>{new Date(revision.createdAt).toLocaleString("ja-JP")}</small>
                </div>
                <p>{revision.editSummary}</p>
                {revision.authorHandle ? <small>@{revision.authorHandle}</small> : null}
              </article>
            ))}
            {audits.map((audit, index) => (
              <article className={styles.item} key={`${audit.action}:${audit.targetId ?? index}:${audit.createdAt}`}>
                <div className={styles.itemHeader}>
                  <strong>{audit.action === "article_published" ? "記事を更新" : "監査記録"}</strong>
                  <small>{new Date(audit.createdAt).toLocaleString("ja-JP")}</small>
                </div>
                <span className={styles.kind}>{audit.action}</span>
              </article>
            ))}
            {revisions.length === 0 && audits.length === 0 ? (
              resourceState.history === "loading" ? (
                <p className={styles.empty}>更新履歴を読み込んでいます…</p>
              ) : resourceState.history === "error" ? (
                <p className={styles.empty}>更新履歴を表示できません。</p>
              ) : (
                <p className={styles.empty}>公開後の更新履歴はまだありません。</p>
              )
            ) : null}
          </div>
        </div>
      )}
      {status ? (
        <div
          className={`${styles.status}${statusIsError ? ` ${styles.error}` : ""}`}
          role={statusIsError ? "alert" : "status"}
        >
          <span>{status}</span>
          {hasLoadError ? (
            <button
              className={styles.secondary}
              type="button"
              disabled={busy}
              onClick={() => void load()}
            >
              再読み込み
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
