"use client";

import { useEffect, useState } from "react";

type ScheduledPost = { id: string; body: string; audience: "public" | "followers"; scheduledAt: string; status: "scheduled" | "published" | "cancelled" | "failed"; createdAt: string };

export function ScheduledPostManager() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const load = async () => {
    setLoading(true);
    const response = await fetch("/api/social/scheduled", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setPosts(((await response.json()) as { posts: ScheduledPost[] }).posts);
    else setMessage("予約投稿を読み込めませんでした。再試行してください。");
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const cancel = async (id: string) => {
    const response = await fetch(`/api/social/scheduled?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) { setMessage("予約を取り消しました。"); await load(); }
    else setMessage("予約を取り消せませんでした。");
  };
  const edit = async (post: ScheduledPost) => {
    const body = window.prompt("投稿本文", post.body)?.trim();
    if (!body) return;
    const initial = new Date(post.scheduledAt); initial.setMinutes(initial.getMinutes() - initial.getTimezoneOffset());
    const value = window.prompt("公開日時（YYYY-MM-DDTHH:mm）", initial.toISOString().slice(0, 16));
    if (!value) return;
    const response = await fetch("/api/social/scheduled", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id, body, audience: post.audience, scheduledAt: new Date(value).toISOString() }) });
    if (response.ok) { setMessage("予約投稿を更新しました。"); await load(); }
    else setMessage("日時は1分以上先を指定してください。");
  };
  return <div className="scheduled-post-manager">
    <div className="scheduled-post-manager__heading"><div><strong>予約投稿</strong><small>公開前の投稿を編集・取消できます</small></div><button type="button" onClick={() => void load()} disabled={loading}>再読み込み</button></div>
    {loading ? <div className="scheduled-post-manager__skeleton" aria-label="予約投稿を読み込み中" /> : null}
    {!loading && !posts.length ? <p>予約投稿はありません。</p> : null}
    {posts.map((post) => <article key={post.id}><div><span>{post.status === "scheduled" ? "予約中" : post.status === "failed" ? "公開失敗" : post.status === "published" ? "公開済み" : "取消済み"}</span><time dateTime={post.scheduledAt}>{new Date(post.scheduledAt).toLocaleString("ja-JP")}</time></div><p>{post.body}</p>{post.status === "scheduled" || post.status === "failed" ? <footer><button type="button" onClick={() => void edit(post)}>編集</button><button type="button" onClick={() => void cancel(post.id)}>取り消す</button></footer> : null}</article>)}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
