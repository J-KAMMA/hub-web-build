"use client";

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { useRouter } from "next/navigation";

import { DirectMessage, MessageConversation, Profile } from "@/lib/domain";
import { clsx, formatRelativeJst } from "@/lib/format";
import {
  generateLocalMessageCandidate,
  initialMessageAssistState,
  messageAssistReducer,
  type MessageAssistAction,
  type MessageCompositionMode,
} from "@/lib/message-assist-state";
import { publishMessageUnreadCount } from "@/lib/notification-client";
import { UiStatePanel } from "@/components/ui/primitives";
import {
  IMAGE_LIMIT,
  imageErrorMessage,
  prepareImage,
  uploadPickedImages,
  type PickedImage,
} from "@/components/v2/v2-image-prepare";

function avatarChar(name: string): string {
  return (name?.[0] ?? "?").toUpperCase();
}

function profileAvatar(profile: Profile | undefined) {
  return profile?.avatarUrl
    ? <img src={profile.avatarUrl} alt="" loading="lazy" />
    : avatarChar(profile?.displayName ?? "?");
}

async function getResponseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

type MessagesRefreshPayload = {
  conversations: MessageConversation[];
  messages: DirectMessage[];
  profiles: Profile[];
};

function mergeMessages(current: DirectMessage[], incoming: DirectMessage[]): DirectMessage[] {
  const merged = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) merged.set(message.id, message);
  return [...merged.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function totalUnreadMessages(conversations: MessageConversation[], profileId: string) {
  return conversations.reduce(
    (total, conversation) => total + (conversation.unreadCountByProfileId[profileId] ?? 0),
    0,
  );
}

export function MessagesWorkspace({
  currentProfileId,
  initialConversations,
  initialMessages,
  profiles,
  initialConversationId
}: {
  currentProfileId: string;
  initialConversations: MessageConversation[];
  initialMessages: DirectMessage[];
  profiles: Profile[];
  initialConversationId?: string;
}) {
  /* 読み手が居る面。v2 から描かれたら行き先も v2 へ（2026-09-07）。 */
  const surface = useHubUiSurface();
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [messages, setMessages] = useState(initialMessages);
  const [knownProfiles, setKnownProfiles] = useState(profiles);
  const [draft, setDraft] = useState("");
  const [loadedDraftConversationId, setLoadedDraftConversationId] = useState<string | null>(null);
  const [compositionMode, setCompositionMode] = useState<MessageCompositionMode>("direct");
  const [assistState, dispatchAssist] = useReducer(
    messageAssistReducer,
    initialMessageAssistState,
  );
  const [assistApplied, setAssistApplied] = useState(false);
  const [startTarget, setStartTarget] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [visibleConversationCount, setVisibleConversationCount] = useState(20);
  const [visibleMessageCount, setVisibleMessageCount] = useState(50);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(Boolean(initialConversationId));
  const [activeConversationId, setActiveConversationId] = useState(
    initialConversationId ?? initialConversations[0]?.id
  );
  const [isPending, startTransition] = useTransition();
  const refreshInFlight = useRef(false);
  const assistRequestCounter = useRef(0);
  const sendAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const profileMap = useMemo(
    () => new Map(knownProfiles.map((p) => [p.id, p])),
    [knownProfiles]
  );

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeMessages = messages.filter(
    (m) => m.conversationId === activeConversation?.id
  );

  useEffect(() => {
    if (!activeConversation?.id) return;
    try {
      setDraft(window.localStorage.getItem(`hub.message-draft.${activeConversation.id}`) ?? "");
    } catch {
      setDraft("");
    }
    setLoadedDraftConversationId(activeConversation.id);
    setCompositionMode("direct");
    setAssistApplied(false);
    setImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    dispatchAssist({ type: "candidate_dismissed" });
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!activeConversation?.id || loadedDraftConversationId !== activeConversation.id) return;
    const key = `hub.message-draft.${activeConversation.id}`;
    try {
      if (draft) window.localStorage.setItem(key, draft);
      else window.localStorage.removeItem(key);
    } catch {
      /* Draft persistence is optional; the active input remains usable. */
    }
  }, [activeConversation?.id, draft, loadedDraftConversationId]);

  const partnerId =
    activeConversation?.participantIds.find((id) => id !== currentProfileId) ?? "";
  const partner = profileMap.get(partnerId);
  const conversationPartnerIds = new Set(conversations.flatMap((conversation) => conversation.participantIds));
  const startCandidates = knownProfiles.filter((profile) => profile.id !== currentProfileId && !conversationPartnerIds.has(profile.id));

  const refreshMessages = useCallback(async () => {
    if (refreshInFlight.current || document.visibilityState === "hidden") return;
    refreshInFlight.current = true;
    try {
      const query = activeConversation?.id
        ? `?conversation=${encodeURIComponent(activeConversation.id)}`
        : "";
      const response = await fetch(`/api/messages/conversations${query}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = await response.json() as MessagesRefreshPayload;
      setConversations(payload.conversations);
      publishMessageUnreadCount(totalUnreadMessages(payload.conversations, currentProfileId));
      setMessages((current) => mergeMessages(current, payload.messages));
      setKnownProfiles((current) => {
        const merged = new Map(current.map((profile) => [profile.id, profile]));
        for (const profile of payload.profiles) merged.set(profile.id, profile);
        return [...merged.values()];
      });
    } catch {
      // A transient refresh failure must not erase the current conversation.
    } finally {
      refreshInFlight.current = false;
    }
  }, [activeConversation?.id, currentProfileId]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshMessages();
    };
    const interval = window.setInterval(() => void refreshMessages(), 15_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshMessages]);

  useEffect(() => {
    void refreshMessages();
  }, [activeConversation?.id, refreshMessages]);

  const startConversation = () => {
    if (!startTarget) return;
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/messages/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target_profile_id: startTarget }),
        });
        if (!response.ok) {
          setError(await getResponseError(response, "会話を開始できませんでした。"));
          return;
        }
        const payload = await response.json() as { conversation_id: string };
        router.push(`/messages?conversation=${payload.conversation_id}`);
        router.refresh();
      } catch {
        setError("会話を開始できませんでした。");
      }
    });
  };

  const canSend = Boolean(
    (draft.trim() || images.length) && (compositionMode === "direct" || assistApplied || !draft.trim()),
  );

  const pickImages = async (files: FileList | null) => {
    if (!files?.length || activeConversation?.isE2ee) return;
    const room = IMAGE_LIMIT - images.length;
    const chosen = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!chosen.length) return;
    try {
      const prepared = await Promise.all(chosen.map(prepareImage));
      setImages((current) => {
        const known = new Set(current.map((item) => item.key));
        return [...current, ...prepared.filter((item) => !known.has(item.key))].slice(0, IMAGE_LIMIT);
      });
      setError("");
    } catch (caught) {
      setError(imageErrorMessage(caught, true));
    } finally {
      if (imageInput.current) imageInput.current.value = "";
    }
  };

  const dropImage = (key: string) => {
    setImages((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  };

  const updateDraft = (value: string) => {
    setDraft(value);
    if (assistState.status === "generating" || assistState.status === "preview") {
      dispatchAssist({ type: "source_changed" });
    }
  };

  const selectCompositionMode = (mode: MessageCompositionMode) => {
    setCompositionMode(mode);
    setAssistApplied(false);
    dispatchAssist({ type: "candidate_dismissed" });
  };

  const generateAssistCandidate = async (action: MessageAssistAction) => {
    const source = draft.trim();
    if (!source || assistState.status === "generating") return;
    const requestId = `assist-${++assistRequestCounter.current}`;
    dispatchAssist({ type: "started", requestId, source, action });
    try {
      const candidate = await generateLocalMessageCandidate(source, action);
      dispatchAssist({ type: "succeeded", requestId, candidate });
    } catch (candidateError) {
      dispatchAssist({
        type: "failed",
        requestId,
        message:
          candidateError instanceof Error
            ? candidateError.message
            : "候補を生成できませんでした。",
      });
    }
  };

  const applyAssistCandidate = () => {
    if (assistState.status !== "preview") return;
    setDraft(assistState.candidate);
    setAssistApplied(true);
    dispatchAssist({ type: "candidate_dismissed" });
  };

  const send = () => {
    if (!activeConversation || !canSend) return;
    const sentDraft = draft;
    const sentText = sentDraft.trim();
    const sentImages = images;
    const sentConversationId = activeConversation.id;
    const sentDraftKey = `hub.message-draft.${sentConversationId}`;
    const fingerprint = JSON.stringify([currentProfileId, activeConversation.id, sentText, sentImages.map((image) => image.key)]);
    const attemptKey = `hub.message-attempt.${currentProfileId}.${sentConversationId}`;
    if (sendAttempt.current?.fingerprint !== fingerprint) {
      sendAttempt.current = null;
      try {
        const saved = JSON.parse(window.localStorage.getItem(attemptKey) ?? "null");
        if (saved?.fingerprint === fingerprint && typeof saved.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.id)) {
          sendAttempt.current = saved;
        }
      } catch {
        /* The in-memory attempt still makes this page's retry idempotent. */
      }
      sendAttempt.current ??= { fingerprint, id: crypto.randomUUID() };
    }
    const attempt = sendAttempt.current;
    try {
      window.localStorage.setItem(attemptKey, JSON.stringify(attempt));
    } catch {
      /* Storage is optional; keep the in-memory identifier for retry. */
    }
    setError("");
    startTransition(async () => {
      try {
        let sentImageIds: string[] = [];
        try {
          sentImageIds = sentImages.length
            ? await uploadPickedImages(sentImages, true, "/api/media/dm-images")
            : [];
        } catch (caught) {
          if (activeConversationIdRef.current === sentConversationId) {
            setError(caught instanceof Error && caught.message ? caught.message : "画像を送れませんでした。");
          }
          return;
        }
        const response = await fetch(
          `/api/messages/conversations/${sentConversationId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              preview_text: sentText,
              // Assistは本文の生成について——画像だけの送信はdirectと同じ。
              composition_mode: sentText ? compositionMode : "direct",
              human_approved: Boolean(sentText) && compositionMode === "assist" && assistApplied,
              client_request_id: attempt.id,
              image_ids: sentImageIds,
            })
          }
        );
        if (!response.ok) {
          const responseError = await getResponseError(response, "送信に失敗しました。");
          if (activeConversationIdRef.current === sentConversationId) setError(responseError);
          return;
        }
        const payload = (await response.json()) as { message: DirectMessage };
        setMessages((current) => mergeMessages(current, [payload.message]));
        setConversations((current) =>
          current.map((c) =>
            c.id === sentConversationId
              ? { ...c, lastMessageAt: payload.message.createdAt }
              : c
          )
        );
        if (activeConversationIdRef.current === sentConversationId) {
          setDraft((current) => current === sentDraft ? "" : current);
          setAssistApplied(false);
          dispatchAssist({ type: "candidate_dismissed" });
        }
        sentImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        setImages((current) => current.filter((item) => !sentImages.some((sent) => sent.key === item.key)));
        if (sendAttempt.current === attempt) sendAttempt.current = null;
        try {
          window.localStorage.removeItem(attemptKey);
        } catch {
          /* A completed send still clears the in-memory retry identity. */
        }
        try {
          if (window.localStorage.getItem(sentDraftKey) === sentDraft) window.localStorage.removeItem(sentDraftKey);
        } catch {
          /* The active draft state remains authoritative when storage is blocked. */
        }
        void refreshMessages();
      } catch {
        if (activeConversationIdRef.current === sentConversationId) setError("送信に失敗しました。");
      }
    });
  };

  const markConversationRead = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/messages/conversations/${conversationId}/read`, {
        method: "POST"
      });

      if (!response.ok) {
        setError(await getResponseError(response, "既読状態の更新に失敗しました。"));
        return;
      }

      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId
            ? { ...item, unreadCountByProfileId: { ...item.unreadCountByProfileId, [currentProfileId]: 0 } }
            : item
        )
      );
      const readCount = conversations.find((item) => item.id === conversationId)
        ?.unreadCountByProfileId[currentProfileId] ?? 0;
      publishMessageUnreadCount(
        Math.max(0, totalUnreadMessages(conversations, currentProfileId) - readCount),
      );
      router.refresh();
    } catch {
      setError("既読状態の更新に失敗しました。");
    }
  };

  useEffect(() => {
    if (!activeConversation?.id) return;

    const unread = activeConversation.unreadCountByProfileId[currentProfileId] ?? 0;
    if (unread > 0) {
      void markConversationRead(activeConversation.id);
    }
  }, [activeConversation?.id, activeConversation?.unreadCountByProfileId, currentProfileId]);

  return (
    <div className={clsx("messages-layout", mobileConversationOpen && "messages-layout--conversation-open")}>
      {/* 会話リスト */}
      <section className="messages-list">
        <div className="messages-start">
          <select value={startTarget} onChange={(event) => setStartTarget(event.target.value)} aria-label="メッセージを送る相手">
            <option value="">新しいメッセージ</option>
            {startCandidates.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} (@{profile.handle})</option>)}
          </select>
          <button type="button" onClick={startConversation} disabled={!startTarget || isPending}>開始</button>
        </div>
        {conversations.slice(0, visibleConversationCount).map((conversation) => {
          const pid = conversation.participantIds.find((id) => id !== currentProfileId) ?? "";
          const p = profileMap.get(pid);
          const latest = messages.filter((m) => m.conversationId === conversation.id).at(-1);
          const unread = conversation.unreadCountByProfileId[currentProfileId] ?? 0;

          return (
            <button
              key={conversation.id}
              type="button"
              className={clsx("conv-list-item", activeConversation?.id === conversation.id && "conv-list-item--active")}
              aria-current={activeConversation?.id === conversation.id ? "true" : undefined}
              aria-label={`${p?.displayName ?? "Unknown"}との会話${unread > 0 ? `、未読${unread}件` : ""}`}
              onClick={() => {
                setError("");
                setActiveConversationId(conversation.id);
                setMobileConversationOpen(true);
                router.replace(`/messages?conversation=${conversation.id}`);
                void markConversationRead(conversation.id);
              }}
            >
              <div className="conv-list-item__avatar">{profileAvatar(p)}</div>
              <div className="conv-list-item__body">
                <div className="conv-list-item__name">{p?.displayName ?? "Unknown"}</div>
                <div className="conv-list-item__preview">
                  {latest?.previewText || (latest?.images?.length ? "（画像）" : latest ? "" : "まだメッセージはありません。")}
                </div>
              </div>
              <div className="conv-list-item__meta">
                {latest && (
                  <span className="conv-list-item__time">{formatRelativeJst(latest.createdAt)}</span>
                )}
                {unread > 0 && (
                  <span className="conv-list-item__unread">{unread}</span>
                )}
              </div>
            </button>
          );
        })}
        {conversations.length > visibleConversationCount ? <div className="search-load-more"><button type="button" onClick={() => setVisibleConversationCount((count) => Math.min(100, count + 20))}>もっと見る</button><small>{visibleConversationCount} / {conversations.length}</small></div> : null}
      </section>

      {/* メッセージ詳細 */}
      <section className="messages-detail">
        {activeConversation ? (
          <>
            <header className="conversation-header">
              <button
                type="button"
                className="conversation-header__back"
                aria-label="会話一覧に戻る"
                onClick={() => {
                  setMobileConversationOpen(false);
                  router.replace("/messages");
                }}
              >
                ←
              </button>
              {partner ? (
                <a href={hubSurfacePath(surface, `/profile/${partner.handle}`)} className="conversation-header__avatar" aria-label={`${partner.displayName}のプロフィール`}>
                  {profileAvatar(partner)}
                </a>
              ) : (
                <div className="conversation-header__avatar">{avatarChar("?")}</div>
              )}
              <div>
                {partner ? (
                  <a href={hubSurfacePath(surface, `/profile/${partner.handle}`)} className="conversation-header__name">{partner.displayName}</a>
                ) : (
                  <div className="conversation-header__name">Unknown</div>
                )}
                {partner ? (
                  <a href={hubSurfacePath(surface, `/profile/${partner.handle}`)} className="conversation-header__sub">@{partner.handle}</a>
                ) : (
                  <div className="conversation-header__sub">メッセージ</div>
                )}
              </div>
            </header>

            <aside className="message-prototype-notice">
              この会話は参加者だけに表示されます。秘密鍵やパスワードは送信しないでください。
            </aside>

            <div className="message-thread" aria-live="polite" aria-relevant="additions">
              {activeMessages.length > visibleMessageCount ? <div className="search-load-more"><button type="button" onClick={() => setVisibleMessageCount((count) => Math.min(1000, count + 50))}>以前のメッセージを表示</button><small>{visibleMessageCount} / {activeMessages.length}</small></div> : null}
              {activeMessages.slice(-visibleMessageCount).map((message) => {
                const mine = message.senderProfileId === currentProfileId;
                return (
                  <div key={message.id} className={clsx("message-bubble", mine && "message-bubble--mine")}>
                    {message.previewText ? <div className="message-bubble__content">{message.previewText}</div> : null}
                    {message.images?.length ? (
                      <div className="message-bubble__images">
                        {message.images.map((image) => (
                          <a key={image.id} href={image.fullUrl} target="_blank" rel="noreferrer">
                            <img
                              src={image.url}
                              alt={image.altText || "添付画像"}
                              width={image.width}
                              height={image.height}
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div className="message-bubble__meta">{formatRelativeJst(message.createdAt)}</div>
                  </div>
                );
              })}
              {activeMessages.length === 0 ? (
                <UiStatePanel className="empty-state" state="empty" title="まだメッセージはありません" description="最初のメッセージを入力して会話を始められます。" />
              ) : null}
            </div>

            {error && <p className="inline-error message-error" role="alert">{error}</p>}

            <div className="chat-composer-mode" aria-label="送信方法">
              <button
                type="button"
                className={clsx(compositionMode === "direct" && "is-active")}
                aria-pressed={compositionMode === "direct"}
                onClick={() => selectCompositionMode("direct")}
              >
                Direct
              </button>
              <button
                type="button"
                className={clsx(compositionMode === "assist" && "is-active")}
                aria-pressed={compositionMode === "assist"}
                onClick={() => selectCompositionMode("assist")}
              >
                Assist
              </button>
              <span>
                {compositionMode === "direct"
                  ? "入力した文章をそのまま送信"
                  : "端末内AIが候補を作成。確認するまで送信されません"}
              </span>
            </div>

            {compositionMode === "assist" ? (
              <section className="message-assist" aria-label="AI文章補助">
                <div className="message-assist__actions">
                  <button
                    type="button"
                    onClick={() => void generateAssistCandidate("clarify")}
                    disabled={!draft.trim() || assistState.status === "generating"}
                  >
                    読みやすく
                  </button>
                  <button
                    type="button"
                    onClick={() => void generateAssistCandidate("soften")}
                    disabled={!draft.trim() || assistState.status === "generating"}
                  >
                    やわらかく
                  </button>
                  <button
                    type="button"
                    onClick={() => void generateAssistCandidate("shorten")}
                    disabled={!draft.trim() || assistState.status === "generating"}
                  >
                    短く
                  </button>
                </div>
                {assistState.status === "generating" ? (
                  <p role="status">端末内で候補を作成しています…</p>
                ) : null}
                {assistState.status === "error" ? (
                  <p className="message-assist__error" role="alert">{assistState.message}</p>
                ) : null}
                {assistState.status === "preview" ? (
                  <div className="message-assist__preview">
                    <div>
                      <strong>原文</strong>
                      <p>{assistState.source}</p>
                    </div>
                    <div>
                      <strong>AI候補 <span>未送信</span></strong>
                      <p>{assistState.candidate}</p>
                    </div>
                    <div className="message-assist__decision">
                      <button type="button" onClick={applyAssistCandidate}>
                        候補を入力欄へ反映
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchAssist({ type: "candidate_dismissed" })}
                      >
                        破棄
                      </button>
                    </div>
                  </div>
                ) : null}
                {assistApplied ? (
                  <p className="message-assist__approved" role="status">
                    候補を反映しました。内容を確認して送信してください。
                  </p>
                ) : null}
              </section>
            ) : null}

            {images.length ? (
              <div className="chat-composer__images" role="list">
                {images.map((item) => (
                  <span key={item.key} className="chat-composer__image" role="listitem">
                    <img src={item.previewUrl} alt={item.altText || "添付予定の画像"} />
                    <button type="button" aria-label="画像を外す" onClick={() => dropImage(item.key)}>×</button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="chat-composer">
              {!activeConversation.isE2ee ? (
                <>
                  <input
                    ref={imageInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    onChange={(event) => void pickImages(event.target.files)}
                  />
                  <button
                    type="button"
                    className="chat-composer__attach"
                    onClick={() => imageInput.current?.click()}
                    disabled={isPending || images.length >= IMAGE_LIMIT}
                    aria-label="画像を添付"
                    title="画像を添付"
                  >
                    ＋
                  </button>
                </>
              ) : null}
              <textarea
                className="chat-composer__input"
                placeholder="メッセージを入力…"
                aria-label={`${partner?.displayName ?? "相手"}へのメッセージ`}
                value={draft}
                maxLength={280}
                onChange={(e) => updateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) send();
                  }
                }}
                disabled={isPending}
                rows={1}
              />
              <button
                type="button"
                className="chat-composer__send"
                onClick={send}
                disabled={isPending || !canSend}
                aria-label="送信"
              >
                ↑
              </button>
            </div>
          </>
        ) : (
          <UiStatePanel className="empty-state" state="empty" title="会話を選んでください" description="左の一覧から会話を選ぶか、新しい会話を開始してください。" />
        )}
      </section>
    </div>
  );
}
