"use client";

import { hubApiErrorMessage } from "@/lib/platform/api-error";

import React, { useEffect, useRef, useState } from "react";

import { ExternalLinkCard } from "@/components/external-link-card";
import { UiButton, UiTextarea } from "@/components/ui/primitives";
import type { HubLocale } from "@/lib/i18n";
import { publishCreatedPostReply } from "@/lib/post-reply-client";
import { recordPersonalNodeEventOnce } from "@/lib/personal-node-local-keystore";
import type { PostPageTimelinePost } from "@/lib/server/post-page-data";
import { hubUi } from "@/lib/ui-copy";

interface PostReplyComposerProps {
  postId: string;
  locale: HubLocale;
  currentUserProfileId: string;
  currentUserDisplayName: string;
  currentUserAvatarUrl?: string;
}

type ReplySubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "failed"; message: string };

type StoredReplyDraft = {
  version: 1;
  body: string;
  requestId?: string;
  savedAt: number;
};

const REPLY_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function avatarChar(name: string): string {
  return (name?.[0] ?? "?").toUpperCase();
}

export function PostReplyComposer({
  postId,
  locale,
  currentUserProfileId,
  currentUserDisplayName,
  currentUserAvatarUrl
}: PostReplyComposerProps) {
  const ui = hubUi(locale);
  const [body, setBody] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [submission, setSubmission] = useState<ReplySubmissionState>({ status: "idle" });
  const inFlightRef = useRef(false);
  const attemptRef = useRef<{ body: string; requestId: string } | null>(null);
  const isSubmitting = submission.status === "submitting";
  const draftKey = `hub.post-reply-draft.v1.${encodeURIComponent(currentUserProfileId)}.${encodeURIComponent(postId)}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      const stored = raw ? JSON.parse(raw) as Partial<StoredReplyDraft> : null;
      const valid = stored?.version === 1
        && typeof stored.body === "string"
        && typeof stored.savedAt === "number"
        && Date.now() - stored.savedAt <= REPLY_DRAFT_MAX_AGE_MS;
      if (valid) {
        setBody(stored.body!);
        if (typeof stored.requestId === "string" && /^[0-9a-f-]{36}$/i.test(stored.requestId)) {
          attemptRef.current = { body: stored.body!, requestId: stored.requestId };
        }
      } else if (raw) {
        window.localStorage.removeItem(draftKey);
      }
    } catch {
      // Storage may be unavailable in a restricted browser context.
    } finally {
      setDraftReady(true);
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (!body.trim()) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // Replying remains available when device storage is unavailable.
      }
      return;
    }
    const matchingAttempt = attemptRef.current?.body === body.trim() ? attemptRef.current : null;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({
        version: 1,
        body,
        requestId: matchingAttempt?.requestId,
        savedAt: Date.now(),
      } satisfies StoredReplyDraft));
    } catch {
      // Replying remains available when device storage is unavailable.
    }
  }, [body, draftKey, draftReady]);

  const submit = async () => {
    const normalizedBody = body.trim();
    if (!normalizedBody || inFlightRef.current) return;

    const attempt = attemptRef.current?.body === normalizedBody
      ? attemptRef.current
      : { body: normalizedBody, requestId: crypto.randomUUID() };
    attemptRef.current = attempt;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({
        version: 1,
        body,
        requestId: attempt.requestId,
        savedAt: Date.now(),
      } satisfies StoredReplyDraft));
    } catch {
      // The server-side idempotency key still protects this active request.
    }
    inFlightRef.current = true;
    setSubmission({ status: "submitting" });

    try {
      await recordPersonalNodeEventOnce("hub.post.create", attempt.requestId, {
        canonicalPostId: `urn:uuid:${attempt.requestId}`,
        body: normalizedBody,
        replyToPostId: postId,
        audience: "public",
      });
      const response = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: normalizedBody,
          identity_mode: "account",
          reply_to_post_id: postId,
          client_request_id: attempt.requestId,
        })
      });
      const payload = await response.json().catch(() => null) as {
        error?: unknown;
        post?: PostPageTimelinePost;
      } | null;
      if (!response.ok || !payload?.post) {
        setSubmission({ status: "failed", message: hubApiErrorMessage(payload?.error, ui.tweet.updateFailed) });
        return;
      }
      attemptRef.current = null;
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // The reply is already confirmed; stale storage can expire naturally.
      }
      setBody("");
      setSubmission({ status: "idle" });
      publishCreatedPostReply(postId, payload.post);
    } catch {
      setSubmission({ status: "failed", message: ui.feed.connectionFailed });
    } finally {
      inFlightRef.current = false;
    }
  };

  return (
    <section className="post-detail__composer" aria-label={ui.tweet.reply}>
      <span className="post-detail__composer-avatar" aria-hidden="true">
        {currentUserAvatarUrl ? <img src={currentUserAvatarUrl} alt="" /> : avatarChar(currentUserDisplayName)}
      </span>
      <div className="post-detail__composer-body">
        <UiTextarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit();
          }}
          placeholder={ui.tweet.replyPlaceholder}
          disabled={isSubmitting}
        />
        <ExternalLinkCard body={body} />
        <div className="post-detail__composer-footer">
          <span className="tl-compose__identity">{ui.tweet.account} ({currentUserDisplayName})</span>
          <UiButton type="button" tone="primary" pending={isSubmitting} pendingLabel={ui.feed.posting} onClick={() => void submit()} disabled={!body.trim()}>
            {ui.tweet.submitReply}
          </UiButton>
        </div>
        {submission.status === "failed" ? <p className="inline-error" role="alert">{submission.message}</p> : null}
      </div>
    </section>
  );
}
