"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ThreadPostVote } from "@/components/thread-post-vote";
import type { ThreadPost, ThreadPostVoteSummary } from "@/lib/domain";
import type { HubThreadTargetType } from "@/lib/hub-thread-system";
import {
  ROLE_LABELS,
  THREAD_POST_ROLES,
  classifySummarySection,
  SUMMARY_SECTION_LABELS,
  type ThreadPostRole,
  type ThreadSource,
} from "@/lib/thread-knowledge";

type ThreadPostKnowledge = {
  role: ThreadPostRole;
  supersedesPostId: string | null;
  correctedByPostId: string | null;
  correctedByPostNo: number | null;
  freshness: "current" | "possibly_outdated" | "outdated";
  sources: ThreadSource[];
};

type Post = ThreadPost & {
  voteSummary?: ThreadPostVoteSummary;
  knowledge?: ThreadPostKnowledge;
};

type LoadState = "loading" | "ready" | "error";

export function EmbeddedHubThread({
  targetType,
  targetId,
  authenticated,
  loginHref = "/auth",
  title = "トーク",
}: {
  targetType: HubThreadTargetType;
  targetId: string;
  authenticated: boolean;
  loginHref?: string;
  title?: string;
}) {
  const endpoint = `/api/hub-threads/${targetType}/${encodeURIComponent(targetId)}`;
  const [posts, setPosts] = useState<Post[]>([]);
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<Post | null>(null);
  const [summary, setSummary] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [role, setRole] = useState<ThreadPostRole>("unspecified");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceKind, setSourceKind] =
    useState<ThreadSource["kind"]>("other");
  const [supersedes, setSupersedes] = useState("");
  const loadRequestId = useRef(0);
  const resolvedLoginHref = loginHref ?? (
    targetType === "shopping_review"
      ? `/auth?next=${encodeURIComponent(`/shopping/${targetId}`)}`
      : "/auth"
  );

  const load = useCallback(async () => {
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoadState("loading");
    try {
      const response = await fetch(endpoint, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        posts?: Post[];
      };
      if (!response.ok || !Array.isArray(payload.posts)) {
        throw new Error("thread_load_failed");
      }
      if (loadRequestId.current !== requestId) return;
      setPosts(payload.posts);
      setLoadState("ready");
    } catch {
      if (loadRequestId.current !== requestId) return;
      setLoadState("error");
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestId.current += 1;
    };
  }, [load]);

  const visible = useMemo(() => {
    const selected = summary
      ? posts.filter((post, index) =>
        index === 0 ||
        (post.voteSummary?.score ?? 0) >= 3 ||
        (
          post.knowledge?.role === "counterpoint" &&
          (post.voteSummary?.up ?? 0) +
            (post.voteSummary?.down ?? 0) >=
            3
        ))
      : posts;
    if (!summary) return selected;
    return [...selected].sort((left, right) => {
      const order = {
        key_points: 0,
        answers: 1,
        different_views: 2,
        evidence: 3,
      };
      const leftSection = classifySummarySection(
        left.knowledge?.role ?? "unspecified",
        left.voteSummary?.score ?? 0,
        left.voteSummary?.down ?? 0,
      );
      const rightSection = classifySummarySection(
        right.knowledge?.role ?? "unspecified",
        right.voteSummary?.score ?? 0,
        right.voteSummary?.down ?? 0,
      );
      return order[leftSection] - order[rightSection] ||
        (right.voteSummary?.score ?? 0) -
          (left.voteSummary?.score ?? 0);
    });
  }, [posts, summary]);

  const submit = async () => {
    if (!authenticated) {
      setMessage("投稿するにはログインしてください。");
      return;
    }
    if (!body.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          parentPostId: reply?.id,
          anonymous,
          role,
          supersedesPostId: supersedes || null,
          sources: sourceUrl
            ? [{ url: sourceUrl, label: "", kind: sourceKind }]
            : [],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        posts?: Post[];
        error?: string;
      };
      if (!response.ok || !payload.posts) {
        setMessage(payload.error ?? "投稿できませんでした。");
        return;
      }
      setPosts(payload.posts);
      setBody("");
      setReply(null);
      setRole("unspecified");
      setSourceUrl("");
      setSupersedes("");
      setLoadState("ready");
    } catch {
      setMessage(
        "投稿できませんでした。接続を確認して、もう一度お試しください。",
      );
    } finally {
      setBusy(false);
    }
  };

  const countLabel = loadState === "ready"
    ? `${posts.length}レス`
    : loadState === "loading"
      ? "読み込み中"
      : "読み込み失敗";

  return (
    <section
      className="embedded-hub-thread"
      aria-busy={loadState === "loading"}
    >
      <header>
        <div>
          <strong>{title}</strong>
          <span>{countLabel}</span>
        </div>
        <nav aria-label="トークの表示">
          <button
            type="button"
            className={!summary ? "is-active" : ""}
            aria-pressed={!summary}
            onClick={() => setSummary(false)}
          >
            すべて
          </button>
          <button
            type="button"
            className={summary ? "is-active" : ""}
            aria-pressed={summary}
            onClick={() => setSummary(true)}
          >
            まとめ
          </button>
        </nav>
      </header>

      {loadState === "loading" ? (
        <p className="embedded-hub-thread__load-state" role="status">
          トークを読み込んでいます…
        </p>
      ) : null}
      {loadState === "error" ? (
        <div className="embedded-hub-thread__load-state" role="alert">
          <p>トークを読み込めませんでした。接続を確認して再試行してください。</p>
          <button type="button" onClick={() => void load()}>
            トークを再読み込み
          </button>
        </div>
      ) : null}

      {loadState === "ready" ? (
        <div className="embedded-hub-thread__posts">
          {visible.map((post, index) => {
            const section = classifySummarySection(
              post.knowledge?.role ?? "unspecified",
              post.voteSummary?.score ?? 0,
              post.voteSummary?.down ?? 0,
            );
            const previous = index ? visible[index - 1] : null;
            const previousSection = previous
              ? classifySummarySection(
                previous.knowledge?.role ?? "unspecified",
                previous.voteSummary?.score ?? 0,
                previous.voteSummary?.down ?? 0,
              )
              : null;
            return (
              <React.Fragment key={post.id}>
                {summary && section !== previousSection ? (
                  <h3 className="thread-summary-section">
                    {SUMMARY_SECTION_LABELS[section]}
                  </h3>
                ) : null}
                <article>
                  <b>{post.no}</b>
                  <div>
                    <header>
                      <strong>{post.displayName}</strong>
                      <time>{new Date(post.createdAt).toLocaleString("ja-JP")}</time>
                      {post.knowledge?.role &&
                      post.knowledge.role !== "unspecified" ? (
                          <span className="thread-role-badge">
                            {ROLE_LABELS[post.knowledge.role]}
                          </span>
                        ) : null}
                    </header>
                    {post.replyToPostId ? <small>返信</small> : null}
                    <p>{post.body}</p>
                    {post.knowledge?.sources.map((source) => (
                      <a
                        className="thread-source-link"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer nofollow ugc"
                        key={source.url}
                      >
                        出典を確認 ↗
                      </a>
                    ))}
                    <footer>
                      <ThreadPostVote
                        postId={post.id}
                        initial={post.voteSummary ?? {
                          up: 0,
                          down: 0,
                          score: 0,
                          viewerVote: null,
                        }}
                        authenticated={authenticated}
                      />
                      {authenticated ? (
                        <button type="button" onClick={() => setReply(post)}>
                          返信
                        </button>
                      ) : null}
                    </footer>
                  </div>
                </article>
              </React.Fragment>
            );
          })}
        </div>
      ) : null}

      {loadState === "ready" && summary && visible.length <= 1 ? (
        <p>評価3以上のレスが集まると、ここに自動で掲載されます。</p>
      ) : null}

      {authenticated ? (
        <div className="embedded-hub-thread__composer">
          {reply ? (
            <p>
              レス {reply.no} に返信{" "}
              <button type="button" onClick={() => setReply(null)}>
                解除
              </button>
            </p>
          ) : null}
          <textarea
            value={body}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="トークに参加する"
          />
          <div className="thread-reply-metadata">
            <label>
              種類
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as ThreadPostRole)}
              >
                {THREAD_POST_ROLES.map((value) => (
                  <option value={value} key={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            {role === "correction" ? (
              <label>
                訂正するレス番号
                <input
                  value={supersedes}
                  inputMode="numeric"
                  onChange={(event) =>
                    setSupersedes(event.target.value.replace(/\D/g, ""))}
                />
              </label>
            ) : null}
            <label>
              出典URL
              <input
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://"
              />
            </label>
            {sourceUrl ? (
              <label>
                出典種別
                <select
                  value={sourceKind}
                  onChange={(event) =>
                    setSourceKind(event.target.value as ThreadSource["kind"])}
                >
                  <option value="primary">一次情報</option>
                  <option value="news">報道</option>
                  <option value="personal">個人投稿</option>
                  <option value="other">その他</option>
                </select>
              </label>
            ) : null}
          </div>
          <label>
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
            />
            匿名で投稿
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !body.trim()}
          >
            {busy ? "投稿中…" : "投稿"}
          </button>
          {message ? <small role="status">{message}</small> : null}
        </div>
      ) : (
        <div className="embedded-hub-thread__composer">
          <strong>トークに参加するにはログインが必要です</strong>
          <p>ログイン後、このページへ戻って投稿できます。</p>
          <a href={resolvedLoginHref}>ログインしてトークに参加</a>
        </div>
      )}
    </section>
  );
}
