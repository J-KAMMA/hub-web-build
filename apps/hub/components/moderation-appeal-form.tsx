"use client";

import { FormEvent, useEffect, useState } from "react";

type EligiblePost = {
  postId: string;
  preview: string;
  moderationStatus: "auto_held" | "hidden";
  reason: string;
  updatedAt: string;
};
type PostAppeal = {
  appealId: string;
  postId: string;
  message: string;
  status: "open" | "accepted" | "rejected";
  resolutionNote: string;
  createdAt: string;
};
type ProfileAppeal = {
  id: string;
  message: string;
  status: "open" | "accepted" | "rejected";
  resolutionNote: string;
  createdAt: string;
};

export function ModerationAppealForm() {
  const [profileMessage, setProfileMessage] = useState("");
  const [profileEligible, setProfileEligible] = useState(false);
  const [profileAppeals, setProfileAppeals] = useState<ProfileAppeal[]>([]);
  const [suspensionReason, setSuspensionReason] = useState("");
  const [eligiblePosts, setEligiblePosts] = useState<EligiblePost[]>([]);
  const [appeals, setAppeals] = useState<PostAppeal[]>([]);
  const [selectedPostId, setSelectedPostId] = useState("");
  const [postMessage, setPostMessage] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadPostAppeals() {
    const response = await fetch("/api/moderation/post-appeals", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as {
      eligiblePosts?: EligiblePost[];
      appeals?: PostAppeal[];
    };
    if (response.ok) {
      setEligiblePosts(payload.eligiblePosts ?? []);
      setAppeals(payload.appeals ?? []);
      setSelectedPostId((current) => current || payload.eligiblePosts?.[0]?.postId || "");
    }
  }

  async function loadProfileAppeals() {
    const response = await fetch("/api/moderation/appeals", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as {
      eligible?: boolean;
      suspensionReason?: string;
      appeals?: ProfileAppeal[];
    };
    if (response.ok) {
      setProfileEligible(Boolean(payload.eligible));
      setSuspensionReason(payload.suspensionReason ?? "");
      setProfileAppeals(payload.appeals ?? []);
    }
  }

  useEffect(() => {
    void Promise.all([loadPostAppeals(), loadProfileAppeals()]).finally(() => setLoading(false));
  }, []);

  async function submitProfileAppeal(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/moderation/appeals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: profileMessage }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; duplicate?: boolean };
    setStatus(response.ok
      ? payload.duplicate ? "異議申立てはすでに審査中です。" : "プロフィール停止への異議申立てを受け付けました。"
      : payload.error || "送信できませんでした。");
    if (response.ok) {
      setProfileMessage("");
      await loadProfileAppeals();
    }
  }

  async function submitPostAppeal(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/moderation/post-appeals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId: selectedPostId, message: postMessage }),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      receipt?: { duplicate?: boolean };
    };
    setStatus(response.ok
      ? payload.receipt?.duplicate ? "この投稿の異議申立てはすでに審査中です。" : "投稿の異議申立てを受け付けました。"
      : payload.error || "送信できませんでした。");
    if (response.ok) {
      setPostMessage("");
      await loadPostAppeals();
    }
  }

  const profilePending = profileAppeals.some((appeal) => appeal.status === "open");

  return <div className="moderation-appeal-list">
    <section className="moderation-appeal">
      <h2>異議申立て</h2>
      <p>自動判定だけで確定せず、運営が内容と申立てを確認します。審査中の重複申請は一件として扱われます。</p>
      {status ? <p role="status">{status}</p> : null}
    </section>

    <form className="moderation-appeal" onSubmit={submitPostAppeal}>
      <h2>非表示の投稿について申請</h2>
      {loading ? <p>読み込み中…</p> : eligiblePosts.length ? <>
        <label>対象の投稿
          <select value={selectedPostId} onChange={(event) => setSelectedPostId(event.target.value)} required>
            {eligiblePosts.map((post) => <option key={post.postId} value={post.postId}>
              {post.moderationStatus === "auto_held" ? "安全確認中" : "非表示"} ・ {post.preview || "本文なし"}
            </option>)}
          </select>
        </label>
        <label>確認してほしい事実
          <textarea value={postMessage} onChange={(event) => setPostMessage(event.target.value)}
            minLength={20} maxLength={2000} required />
        </label>
        <button type="submit">審査を依頼する</button>
      </> : <p>現在、異議申立てが可能な投稿はありません。</p>}
      {appeals.length ? <div><h3>申請履歴</h3>{appeals.map((appeal) => <p key={appeal.appealId}>
        <strong>{appeal.status === "open" ? "審査中" : appeal.status === "accepted" ? "復元済み" : "非表示を継続"}</strong>
        {appeal.resolutionNote ? ` ・ ${appeal.resolutionNote}` : ""}
      </p>)}</div> : null}
    </form>

    <section className="moderation-appeal">
      <h2>プロフィール停止について申請</h2>
      {profileEligible ? <form onSubmit={submitProfileAppeal}>
        {suspensionReason ? <p>停止理由：{suspensionReason}</p> : null}
        <p>停止判断に誤りがある場合、理由と確認してほしい事実を記載してください。</p>
        <textarea value={profileMessage} onChange={(event) => setProfileMessage(event.target.value)}
          minLength={20} maxLength={2000} required disabled={profilePending} />
        <button type="submit" disabled={profilePending}>{profilePending ? "審査中" : "送信する"}</button>
      </form> : <p>現在、プロフィールは停止されていません。</p>}
      {profileAppeals.length ? <div><h3>申請履歴</h3>{profileAppeals.map((appeal) => <p key={appeal.id}>
        <strong>{appeal.status === "open" ? "審査中" : appeal.status === "accepted" ? "停止解除" : "申請却下"}</strong>
        {appeal.resolutionNote ? ` ・ ${appeal.resolutionNote}` : ""}
      </p>)}</div> : null}
    </section>
  </div>;
}
