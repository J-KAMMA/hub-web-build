"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BBS_LIMITS } from "@/lib/bbs-content-quality";
import { ThreadAuthorControl } from "./thread-author-control";

type Revision = { id: string; body: string; createdAt: string; editReason?: string };

interface Props {
  postId: string;
  body: string;
  viewerIsAuthor: boolean;
  canControlAuthor: boolean;
  blocked: boolean;
  deleted: boolean;
  edited: boolean;
}

export function ThreadPostActions({ postId, body, viewerIsAuthor, canControlAuthor, blocked, deleted, edited }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"closed" | "edit" | "history" | "delete">("closed");
  const [draft, setDraft] = useState(body);
  const [editReason, setEditReason] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [message, setMessage] = useState("");

  const request = (action: () => Promise<Response>, failureMessage: string, onSuccess?: (response: Response) => Promise<void> | void) => {
    setMessage("");
    startTransition(async () => {
      try {
        const response = await action();
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          setMessage(payload.error ?? failureMessage);
          return;
        }
        await onSuccess?.(response);
      } catch {
        setMessage(failureMessage);
      }
    });
  };

  const editPost = () => request(
    () => fetch(`/api/bbs/thread-posts/${postId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draft.trim(), edit_reason: editReason.trim() }) }),
    "投稿を編集できませんでした。",
    () => { setMode("closed"); router.refresh(); }
  );

  const deletePost = () => request(
    () => fetch(`/api/bbs/thread-posts/${postId}`, { method: "DELETE" }),
    "投稿を削除できませんでした。",
    () => { setMode("closed"); router.refresh(); }
  );

  const loadHistory = () => {
    setMode("history");
    request(
      () => fetch(`/api/bbs/thread-posts/${postId}/history`),
      "編集履歴を取得できませんでした。",
      async (response) => setRevisions(((await response.json()) as { revisions: Revision[] }).revisions)
    );
  };

  return <div className="thread-post-actions">
    <div className="thread-post-actions__buttons">
      {viewerIsAuthor ? <>
        {!deleted && <button type="button" onClick={() => setMode(mode === "edit" ? "closed" : "edit")}>編集</button>}
        {!deleted && <button type="button" onClick={() => setMode(mode === "delete" ? "closed" : "delete")}>削除</button>}
        {edited && <button type="button" onClick={loadHistory}>履歴</button>}
      </> : <>
        {canControlAuthor && !deleted && <ThreadAuthorControl postId={postId} kinds={["block"]} disabled={isPending} />}
      </>}
    </div>

    {mode === "edit" && <div className="thread-post-actions__panel">
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={BBS_LIMITS.bodyMax} disabled={isPending} />
      <input value={editReason} onChange={(event) => setEditReason(event.target.value)} maxLength={300} placeholder="変更理由（任意）" disabled={isPending} />
      <small>{draft.length}/{BBS_LIMITS.bodyMax}</small>
      <div><button type="button" onClick={() => setMode("closed")}>キャンセル</button><button type="button" onClick={editPost} disabled={isPending || draft.trim().length < BBS_LIMITS.replyBodyMin}>保存</button></div>
    </div>}

    {mode === "delete" && <div className="thread-post-actions__panel thread-post-actions__confirm"><p>レス番号と返信関係を残して本文を削除します。</p><div><button type="button" onClick={() => setMode("closed")}>キャンセル</button><button type="button" className="thread-post-actions__danger" onClick={deletePost} disabled={isPending}>削除する</button></div></div>}

    {mode === "history" && <div className="thread-post-actions__panel thread-post-actions__history">
      <strong>編集前の内容</strong>
      {isPending ? <p>読み込み中…</p> : revisions.length ? revisions.map((revision)=><article key={revision.id}><time>{new Date(revision.createdAt).toLocaleString()}</time>{revision.editReason && <small>{revision.editReason}</small>}<p>{revision.body}</p></article>) : <p>履歴はありません。</p>}
      <button type="button" onClick={() => setMode("closed")}>閉じる</button>
    </div>}
    {message && <p className="thread-post-actions__message" role="status">{message}</p>}
  </div>;
}
