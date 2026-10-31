"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/v2/ui";
import { useV2Images, V2ImageButton, V2ImageList } from "@/components/v2/v2-image-picker";
import { useV2Mentions, V2MentionList } from "@/components/v2/v2-mentions";
import { recordPersonalNodeEventOnce } from "@/lib/personal-node-local-keystore";
import { publishCreatedPostReply } from "@/lib/post-reply-client";
import { hubApiErrorMessage } from "@/lib/platform/api-error";
import type { PostPageTimelinePost } from "@/lib/server/post-page-data";

/*
 * 返信を書く欄。既存の post-reply-composer.tsx と**同じ契約**で動く。
 *
 * 落とさなかったもの:
 *   - 下書きは localStorage の同じ鍵（hub.post-reply-draft.v1.{profile}.{post}）。
 *     v1で書きかけた返信がv2にも出る。7日で捨てる
 *   - 二重送信の防止。同じ本文には同じ requestId を使い、下書きにも残す。
 *     途中で閉じても、次に送るときは同じ鍵で送るので二重にならない
 *   - 送る前に端末側の記録（recordPersonalNodeEventOnce）
 *   - 送れたら publishCreatedPostReply。一覧と件数はそのイベントで増える
 *   - Ctrl+Enter で送る
 *
 * まだ無いもの: メンション補完、画像、外部リンクカードの下見。
 */

type Submission =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "failed"; message: string };

type StoredDraft = {
  version: 1;
  body: string;
  requestId?: string;
  savedAt: number;
};

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BODY_MAX = 280;

export function V2ReplyComposer({
  postId,
  viewerId,
  viewerName,
  viewerAvatarUrl,
  japanese,
}: {
  postId: string;
  viewerId: string;
  viewerName: string;
  viewerAvatarUrl?: string;
  japanese: boolean;
}) {
  const [body, setBody] = useState("");
  const [ready, setReady] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const inFlight = useRef(false);
  const attempt = useRef<{ body: string; requestId: string } | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const mentions = useV2Mentions(body, setBody, input);
  const picker = useV2Images(japanese, (message) => setSubmission({ status: "failed", message }));
  const draftKey = `hub.post-reply-draft.v1.${encodeURIComponent(viewerId)}.${encodeURIComponent(postId)}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      const stored = raw ? JSON.parse(raw) as Partial<StoredDraft> : null;
      const valid = stored?.version === 1
        && typeof stored.body === "string"
        && typeof stored.savedAt === "number"
        && Date.now() - stored.savedAt <= DRAFT_MAX_AGE_MS;
      if (valid && stored?.body) {
        setBody(stored.body);
        if (typeof stored.requestId === "string" && /^[0-9a-f-]{36}$/i.test(stored.requestId)) {
          attempt.current = { body: stored.body, requestId: stored.requestId };
        }
      } else if (raw) {
        window.localStorage.removeItem(draftKey);
      }
    } catch {
      /* 保存できない環境でも返信はできる。 */
    } finally {
      setReady(true);
    }
  }, [draftKey]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (!body.trim()) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      const matching = attempt.current?.body === body.trim() ? attempt.current : null;
      window.localStorage.setItem(draftKey, JSON.stringify({
        version: 1,
        body,
        requestId: matching?.requestId,
        savedAt: Date.now(),
      } satisfies StoredDraft));
    } catch {
      /* 保存できない環境でも返信はできる。 */
    }
  }, [body, draftKey, ready]);

  const submit = async () => {
    const normalized = body.trim();
    if (!normalized || inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSubmission({ status: "failed", message: japanese ? "オフラインです。繋がってから送ってください。下書きは残っています。" : "You are offline. The draft is kept; send it once you are back online." });
      return;
    }

    const current = attempt.current?.body === normalized
      ? attempt.current
      : { body: normalized, requestId: crypto.randomUUID() };
    attempt.current = current;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({
        version: 1,
        body,
        requestId: current.requestId,
        savedAt: Date.now(),
      } satisfies StoredDraft));
    } catch {
      /* サーバー側の冪等キーが同じ働きをする。 */
    }

    inFlight.current = true;
    setSubmission({ status: "submitting" });
    try {
      let imageIds: string[] = [];
      try {
        imageIds = await picker.upload();
      } catch (caught) {
        setSubmission({ status: "failed", message: caught instanceof Error && caught.message ? caught.message : (japanese ? "画像を送れませんでした。" : "Could not upload the image.") });
        return;
      }
      await recordPersonalNodeEventOnce("hub.post.create", current.requestId, {
        canonicalPostId: `urn:uuid:${current.requestId}`,
        body: normalized,
        replyToPostId: postId,
        audience: "public",
        imageIds,
      });
      const response = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: normalized,
          identity_mode: "account",
          reply_to_post_id: postId,
          image_ids: imageIds,
          client_request_id: current.requestId,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: unknown; post?: PostPageTimelinePost } | null;
      if (!response.ok || !payload?.post) {
        setSubmission({
          status: "failed",
          message: hubApiErrorMessage(payload?.error, japanese ? "返信できませんでした。" : "Could not post the reply."),
        });
        return;
      }
      attempt.current = null;
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        /* 送れたあとの下書きは、期限で自然に消える。 */
      }
      setBody("");
      picker.clear();
      setSubmission({ status: "idle" });
      publishCreatedPostReply(postId, payload.post);
    } catch {
      setSubmission({
        status: "failed",
        message: japanese ? "通信できませんでした。" : "Could not reach the server.",
      });
    } finally {
      inFlight.current = false;
    }
  };

  const submitting = submission.status === "submitting";
  const remaining = BODY_MAX - body.length;

  return (
    <section className="v2-reply" aria-label={japanese ? "返信を書く" : "Write a reply"}>
      <Avatar className="v2-compose__avatar" name={viewerName} src={viewerAvatarUrl} size={40} />
      <div className="v2-reply__body">
        <textarea
          ref={input}
          className="v2-reply__input"
          value={body}
          maxLength={BODY_MAX}
          disabled={submitting}
          placeholder={japanese ? "返信を書く" : "Write a reply"}
          aria-label={japanese ? "返信の本文" : "Reply body"}
          aria-controls={mentions.suggestions.length ? "v2-reply-mentions" : undefined}
          onChange={mentions.onChange}
          onKeyDown={(event) => {
            if (mentions.onKeyDown(event)) return;
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit();
          }}
        />
        <V2MentionList id="v2-reply-mentions" suggestions={mentions.suggestions} selected={mentions.selected} onChoose={mentions.choose} japanese={japanese} />
        <V2ImageList images={picker.images} onDrop={picker.drop} onDescribe={picker.describe} japanese={japanese} />
        <div className="v2-reply__footer">
          <span className="v2-reply__identity">{viewerName}</span>
          <V2ImageButton picker={picker} disabled={submitting} japanese={japanese} />
          <span className="v2-reply__remaining" aria-live="polite">{remaining}</span>
          <button
            type="button"
            className="v2-reply__submit"
            disabled={!body.trim() || submitting}
            onClick={() => void submit()}
          >
            {submitting ? (japanese ? "送っています…" : "Sending…") : (japanese ? "返信する" : "Reply")}
          </button>
        </div>
        {submission.status === "failed" ? (
          <p className="v2-error" role="alert">{submission.message}</p>
        ) : null}
      </div>
    </section>
  );
}
