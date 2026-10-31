"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { V2AccessGateAttachToggle } from "@/components/v2/v2-access-gate-attach";
import { applyAccessGate } from "@/components/v2/v2-access-gate-shared";
import { normalizeTagList } from "@jkamma/content-tags";
import { V2Button } from "@/components/v2/v2-button";
import { V2TagInput } from "@/components/v2/v2-tag-input";
import { THREAD_LANGUAGE_LABELS, THREAD_REGION_LABELS } from "@/lib/thread-scope";
import { THREAD_TYPE_LABELS, type ThreadType } from "@/lib/thread-type";

/*
 * 新しいスレッド。既存の new-thread-form.tsx（書き出しの型・IP の制限・許可言語
 * など）から、立てるのに要るものだけを抜いた:
 * 板・題・本文・匿名／アカウント・種別・言語・地域・期限（募集のみ）・タグ。
 * 送り先も応答も既存と同じ（POST /api/bbs/threads → { thread: { id } }）。
 *
 * まだ無いもの: 書き出しの型、許可言語・国・IP の制限、下書きのサーバー保存。
 */

export function V2ThreadNew({
  boards,
  initialBoard,
  presetGateId,
  signedIn,
  japanese,
}: {
  boards: { key: string; title: string }[];
  initialBoard?: string;
  /** ?gate=ID。本人の鍵に含まれるときだけ選ばれる。 */
  presetGateId?: string;
  signedIn: boolean;
  japanese: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(presetGateId));
  const [threadType, setThreadType] = useState<ThreadType>("chat");
  const [pending, setPending] = useState(false);
  const [accessGateId, setAccessGateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (!title || body.length < 30) {
      setError(japanese ? "題と、30字以上の本文を書いてください。" : "A title and a body of at least 30 characters are required.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bbs/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board_key: form.get("board"),
          title,
          body,
          identity_mode: form.get("identity") === "anonymous" ? "anonymous" : "account",
          language: form.get("language"),
          region: form.get("region"),
          thread_type: threadType,
          deadline: threadType === "recruitment" && form.get("deadline") ? form.get("deadline") : null,
          tags: normalizeTagList(tags).map((tag) => tag.display),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; thread?: { id: string } };
      if (!response.ok || !payload.thread) throw new Error(payload.error || String(response.status));
      /* スレッドが立ってから閲覧条件を付ける。失敗してもスレッドは残る。 */
      if (accessGateId) await applyAccessGate("thread", payload.thread.id, accessGateId);
      router.push(`/v2/threads/${payload.thread.id}`);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : (japanese ? "スレッドを作れませんでした。" : "Could not create the thread."));
      setPending(false);
    }
  };

  if (!signedIn) return null;

  return (
    <section className="v2-tnew" aria-label={japanese ? "新しいスレッド" : "New thread"}>
      <V2Button icon="plus" variant="text" label={japanese ? "新しいスレッド" : "New thread"} expanded={open} onClick={() => setOpen((current) => !current)} />
      {open ? (
        <form className="v2-tnew__form" onSubmit={submit}>
          <label className="v2-filter__row">
            <span>{japanese ? "板" : "Board"}</span>
            <select name="board" defaultValue={initialBoard && boards.some((board) => board.key === initialBoard) ? initialBoard : boards[0]?.key}>
              {boards.map((board) => <option key={board.key} value={board.key}>{board.title}</option>)}
            </select>
          </label>
          <input className="v2-tnew__title" type="text" name="title" maxLength={120} required placeholder={japanese ? "題" : "Title"} aria-label={japanese ? "題" : "Title"} />
          <textarea className="v2-reply__input" name="body" rows={6} minLength={30} maxLength={4000} required placeholder={japanese ? "本文（30字以上）。背景と知りたいことを添えると返信が集まりやすい" : "Body (at least 30 characters)"} aria-label={japanese ? "本文" : "Body"} />
          <div className="v2-tnew__row">
            <label className="v2-filter__row">
              <span>{japanese ? "種別" : "Type"}</span>
              <select name="type" value={threadType} onChange={(event) => setThreadType(event.target.value as ThreadType)}>
                {(Object.keys(THREAD_TYPE_LABELS) as ThreadType[]).map((type) => <option key={type} value={type}>{THREAD_TYPE_LABELS[type]}</option>)}
              </select>
            </label>
            <label className="v2-filter__row">
              <span>{japanese ? "名前" : "Identity"}</span>
              <select name="identity" defaultValue="account">
                <option value="account">{japanese ? "アカウント" : "Account"}</option>
                <option value="anonymous">{japanese ? "匿名" : "Anonymous"}</option>
              </select>
            </label>
            <label className="v2-filter__row">
              <span>{japanese ? "言語" : "Language"}</span>
              <select name="language" defaultValue="ja">
                {Object.entries(THREAD_LANGUAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="v2-filter__row">
              <span>{japanese ? "地域" : "Region"}</span>
              <select name="region" defaultValue="global">
                {Object.entries(THREAD_REGION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {threadType === "recruitment" ? (
              <label className="v2-filter__row">
                <span>{japanese ? "期限" : "Deadline"}</span>
                <input type="date" name="deadline" />
              </label>
            ) : null}
          </div>
          <V2TagInput value={tags} onChange={setTags} label={japanese ? "タグ" : "Tags"} placeholder={japanese ? "タグ（空白か読点で区切る）" : "Tags (space or comma separated)"} disabled={pending} />
          {japanese ? <V2AccessGateAttachToggle targetType="thread" gateId={accessGateId} onChange={setAccessGateId} preselectGateId={presetGateId} disabled={pending} /> : null}
          {error ? <p className="v2-error" role="alert">{error}</p> : null}
          <div className="v2-reply__footer">
            <V2Button variant="text" label={japanese ? "やめる" : "Cancel"} onClick={() => setOpen(false)} />
            <V2Button variant="primary" type="submit" label={pending ? (japanese ? "作っています…" : "Creating…") : (japanese ? "スレッドを立てる" : "Create thread")} disabled={pending} />
          </div>
        </form>
      ) : null}
    </section>
  );
}
