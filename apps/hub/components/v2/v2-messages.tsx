"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState, useTransition } from "react";

import type { DirectMessage, MessageConversation, Profile } from "@/lib/domain";
import {
  generateLocalMessageCandidate,
  initialMessageAssistState,
  messageAssistReducer,
  type MessageAssistAction,
  type MessageCompositionMode,
} from "@/lib/message-assist-state";
import { publishMessageUnreadCount } from "@/lib/notification-client";
import { MESSAGE_MAX, conversationPartner, mergeMessages, totalUnreadMessages, unreadFor } from "@/lib/v2-messages";
import { Avatar } from "@/components/v2/ui/avatar";
import { V2Icon } from "@/components/v2/v2-icons";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";
import { IMAGE_LIMIT, imageErrorMessage, prepareImage, uploadPickedImages, type PickedImage } from "@/components/v2/v2-image-prepare";

/*
 * ダイレクトメッセージ。既存の messages-workspace.tsx（540行）から機能だけを抜いた。
 *
 * 落とさなかったもの: 15秒ごとの取り直し（隠れている間は止め、戻ったら取る）、
 * 開いたら既読、280字、下書き（鍵は既存と共用 hub.message-draft.{id}）、
 * Direct／Assist、AIの候補は人が「反映」を押すまで送らない（サーバーも同じ）、
 * 会話を始める（フォローの相手から選ぶ）、未読数の全体同期。
 *
 * まだ無いもの: メール（別の入口へ）、E2EEの検証の表示、右列の相手の情報、
 * 会話一覧の「さらに読み込む」（v2 は内側左列で全件）。
 */

function dayKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string, ja: boolean): string {
  return new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}

const ASSIST_ACTIONS: { id: MessageAssistAction; ja: string; en: string }[] = [
  { id: "clarify", ja: "わかりやすく", en: "Clarify" },
  { id: "soften", ja: "やわらかく", en: "Soften" },
  { id: "shorten", ja: "短く", en: "Shorten" },
];

type RefreshPayload = { conversations: MessageConversation[]; messages: DirectMessage[]; profiles: Profile[]; messageCount: number };

function directorySnapshot(conversations: MessageConversation[], messageCount: number, profileId: string): string {
  return JSON.stringify([messageCount, conversations.map((item) => [item.id, item.lastMessageAt, unreadFor(item, profileId)]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))]);
}

export function V2Messages({
  currentProfileId,
  conversation,
  initialConversations = conversation ? [conversation] : [],
  initialMessageCount,
  initialMessages,
  profiles,
  locale,
}: {
  currentProfileId: string;
  conversation: MessageConversation | null;
  initialConversations?: MessageConversation[];
  initialMessageCount?: number;
  initialMessages: DirectMessage[];
  profiles: Profile[];
  locale: string;
}) {
  const ja = locale === "ja";
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [known, setKnown] = useState<Map<string, Profile>>(() => new Map(profiles.map((profile) => [profile.id, profile])));
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [mode, setMode] = useState<MessageCompositionMode>("direct");
  const [assist, dispatchAssist] = useReducer(messageAssistReducer, initialMessageAssistState);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const refreshGeneration = useRef(0);
  const queuedRefresh = useRef<(() => Promise<void>) | null>(null);
  const lastDirectory = useRef(directorySnapshot(initialConversations, initialMessageCount ?? totalUnreadMessages(initialConversations, currentProfileId), currentProfileId));
  const requestCounter = useRef(0);
  const sendAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const messageRoot = useRef<HTMLDivElement>(null);
  const conversationId = conversation?.id;
  const draftKey = conversation ? `hub.message-draft.${conversation.id}` : null;

  /* 一覧の会話を選んだ直後は、キーボードの焦点を会話側へ渡す。横スクロールは使わない（文書がスクロールする）。 */
  useEffect(() => {
    if (!conversationId) return;
    const main = messageRoot.current?.closest<HTMLElement>(".v2__main");
    if (!main) return;
    const selectedLink = document.activeElement?.closest<HTMLAnchorElement>(".v2__directory a, .v2-messenger__list a");
    if (selectedLink?.getAttribute("href") === `/v2/messages?conversation=${encodeURIComponent(conversationId)}`) {
      main.focus({ preventScroll: true });
    }
  }, [conversationId]);

  /* 会話は下から読む。開いたときと、新着・自分の送信のあと、最後へ送る。 */
  const listRef = useRef<HTMLOListElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [conversationId, lastMessageId]);

  useEffect(() => {
    if (!draftKey) return;
    try { setDraft(localStorage.getItem(draftKey) ?? ""); } catch { setDraft(""); }
    setImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    setLoadedDraftKey(draftKey);
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || loadedDraftKey !== draftKey) return;
    try {
      if (draft) localStorage.setItem(draftKey, draft);
      else localStorage.removeItem(draftKey);
    } catch { /* 端末に書けなくても続ける */ }
  }, [draft, draftKey, loadedDraftKey]);

  const refresh = useCallback(async function refreshMessages(): Promise<void> {
    if (!mounted.current || document.visibilityState === "hidden") return;
    if (inFlight.current) {
      queuedRefresh.current = refreshMessages;
      return;
    }
    inFlight.current = true;
    const generation = refreshGeneration.current;
    try {
      const query = conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : "";
      const response = await fetch(`/api/messages/conversations${query}`, { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok || !mounted.current || generation !== refreshGeneration.current) return;
      const payload = await response.json() as RefreshPayload;
      if (!mounted.current || generation !== refreshGeneration.current) return;
      // 一覧は最大100件。全体の未読数はサーバーの集計を使う。
      if (Number.isSafeInteger(payload.messageCount) && payload.messageCount >= 0) {
        publishMessageUnreadCount(payload.messageCount);
        const snapshot = directorySnapshot(payload.conversations, payload.messageCount, currentProfileId);
        if (snapshot !== lastDirectory.current) {
          lastDirectory.current = snapshot;
          router.refresh();
        }
      }
      setMessages((current) => mergeMessages(current, payload.messages));
      setKnown((current) => {
        const next = new Map(current);
        for (const profile of payload.profiles) next.set(profile.id, profile);
        return next;
      });
    } catch {
      /* 一時的な失敗で今の会話を消さない */
    } finally {
      inFlight.current = false;
      const queued = queuedRefresh.current;
      queuedRefresh.current = null;
      if (mounted.current && queued) void queued();
    }
  }, [conversationId, currentProfileId, router]);

  useEffect(() => {
    mounted.current = true;
    const whenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    void refresh();
    return () => {
      mounted.current = false;
      refreshGeneration.current += 1;
      queuedRefresh.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [refresh]);

  /* 開いたら既読。未読があるときだけ送る。 */
  useEffect(() => {
    if (!conversation || unreadFor(conversation, currentProfileId) === 0) return;
    let active = true;
    fetch(`/api/messages/conversations/${encodeURIComponent(conversation.id)}/read`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        if (!active) return;
        // 既読前に始まったGETを捨て、完了後の全体数を取り直す。
        refreshGeneration.current += 1;
        void refresh();
      })
      .catch(() => { if (active) setError(ja ? "既読状態を更新できませんでした。" : "Could not update read state."); });
    return () => { active = false; };
    // 会話を開いたときに1回だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  const canSend = Boolean(draft.trim() || images.length) && draft.length <= MESSAGE_MAX && (mode === "direct" || applied || !draft.trim());

  const pickImages = async (files: FileList | null) => {
    if (!files?.length || conversation?.isE2ee) return;
    const room = IMAGE_LIMIT - images.length;
    const chosen = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!chosen.length) return;
    try {
      const prepared = await Promise.all(chosen.map(prepareImage));
      setImages((current) => {
        const known = new Set(current.map((item) => item.key));
        return [...current, ...prepared.filter((item) => !known.has(item.key))].slice(0, IMAGE_LIMIT);
      });
      setError(null);
    } catch (caught) {
      setError(imageErrorMessage(caught, ja));
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
    setApplied(false);
    if (assist.status === "generating" || assist.status === "preview") dispatchAssist({ type: "source_changed" });
  };

  const generate = async (action: MessageAssistAction) => {
    const source = draft.trim();
    if (!source || assist.status === "generating") return;
    const requestId = `assist-${++requestCounter.current}`;
    dispatchAssist({ type: "started", requestId, source, action });
    try {
      const candidate = await generateLocalMessageCandidate(source, action);
      dispatchAssist({ type: "succeeded", requestId, candidate });
    } catch (caught) {
      dispatchAssist({ type: "failed", requestId, message: caught instanceof Error ? caught.message : (ja ? "候補を作れませんでした。" : "Could not generate.") });
    }
  };

  /* 候補は人が押して初めて本文になる。押すまでは送れない。 */
  const applyCandidate = () => {
    if (assist.status !== "preview") return;
    setDraft(assist.candidate);
    setApplied(true);
    dispatchAssist({ type: "candidate_dismissed" });
  };

  const send = () => {
    if (!conversation || !canSend || pending) return;
    const sentDraft = draft;
    const sentImages = images;
    const sentDraftKey = draftKey;
    const fingerprint = JSON.stringify([currentProfileId, conversation.id, sentDraft.trim(), sentImages.map((image) => image.key)]);
    const attemptKey = `hub.message-attempt.${currentProfileId}.${conversation.id}`;
    if (sendAttempt.current?.fingerprint !== fingerprint) {
      sendAttempt.current = null;
      try {
        const saved = JSON.parse(localStorage.getItem(attemptKey) ?? "null");
        if (saved?.fingerprint === fingerprint && typeof saved.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.id)) sendAttempt.current = saved;
      } catch { /* メモリ内の識別子で続ける */ }
      sendAttempt.current ??= { fingerprint, id: crypto.randomUUID() };
    }
    const attempt = sendAttempt.current;
    try { localStorage.setItem(attemptKey, JSON.stringify(attempt)); } catch { /* 同じ画面での再試行は保持する */ }
    setError(null);
    startTransition(async () => {
      try {
        let sentImageIds: string[] = [];
        try {
          sentImageIds = sentImages.length ? await uploadPickedImages(sentImages, ja, "/api/media/dm-images") : [];
        } catch (caught) {
          setError(caught instanceof Error && caught.message ? caught.message : (ja ? "画像を送れませんでした。" : "Could not upload the image."));
          return;
        }
        const response = await fetch(`/api/messages/conversations/${encodeURIComponent(conversation.id)}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Assistは本文の生成について——画像だけの送信はdirectと同じ。
          body: JSON.stringify({ preview_text: sentDraft.trim(), composition_mode: sentDraft.trim() ? mode : "direct", human_approved: Boolean(sentDraft.trim()) && mode === "assist" && applied, client_request_id: attempt.id, image_ids: sentImageIds }),
        });
        const payload = await response.json().catch(() => ({})) as { message?: DirectMessage; error?: string };
        if (!response.ok || !payload.message) throw new Error(payload.error || String(response.status));
        setMessages((current) => mergeMessages(current, [payload.message!]));
        setDraft((current) => current === sentDraft ? "" : current);
        sentImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        setImages((current) => current.filter((item) => !sentImages.some((sent) => sent.key === item.key)));
        sendAttempt.current = null;
        try { localStorage.removeItem(attemptKey); } catch { /* 無視 */ }
        // アンマウント後に成功が遅れて届いても、送信済みの本文だけ下書きから消す。
        // setDraft による消去はマウント中しか効かず、ストレージは autosave 経由でしか消えないため。
        try {
          if (sentDraftKey && localStorage.getItem(sentDraftKey) === sentDraft) localStorage.removeItem(sentDraftKey);
        } catch { /* 無視 */ }
        setApplied(false);
        dispatchAssist({ type: "candidate_dismissed" });
        void refresh();
      } catch (caught) {
        setError(caught instanceof Error && caught.message ? caught.message : (ja ? "送信に失敗しました。" : "Could not send."));
      }
    });
  };

  const partner = conversation ? conversationPartner(conversation, currentProfileId, known) : undefined;
  /* 相手の未読が 0 なら、最後の吹き出しが自分のものであるときだけ、その下に「既読」を添える（Hub Desktop と同じ）。 */
  const readByPartner = Boolean(partner?.id) && conversation?.unreadCountByProfileId?.[partner!.id] === 0;

  return (
    <div className="v2-dm" ref={messageRoot}>
      {error ? <p className="v2-error" role="status">{error}</p> : null}

      {conversation ? (
        <>
          <div className="v2-dm__head">
            <Link className="v2-dm__back" href="/v2/messages" aria-label={ja ? "会話の一覧へ戻る" : "Back to conversations"}>
              <V2Icon name="chevron-left" />
            </Link>
            <Avatar name={partner?.displayName} src={partner?.avatarUrl} size={40} />
            <span className="v2-dm__who">
              {partner
                ? <Link className="v2-post__name" href={`/v2/profile/${partner.handle}`}>{partner.displayName}</Link>
                : <span className="v2-post__name">{ja ? "相手" : "Partner"}</span>}
              {partner ? <span className="v2-post__handle">@{partner.handle}</span> : null}
            </span>
            {conversation.isE2ee ? <span className="v2-badge">{ja ? "端末間で暗号化" : "E2EE"}</span> : null}
          </div>

          {messages.length ? (
            <ol className="v2-dm__list" ref={listRef} aria-label={ja ? "メッセージ" : "Messages"}>
              {messages.map((message, index) => {
                const mine = message.senderProfileId === currentProfileId;
                const sender = known.get(message.senderProfileId);
                const previous = messages[index - 1];
                const next = messages[index + 1];
                const day = dayKey(message.createdAt);
                const newDay = !previous || dayKey(previous.createdAt) !== day;
                const joinsPrevious = Boolean(previous) && !newDay && previous!.senderProfileId === message.senderProfileId;
                const joinsNext = Boolean(next) && dayKey(next!.createdAt) === day && next!.senderProfileId === message.senderProfileId;
                const run = joinsPrevious ? (joinsNext ? "mid" : "last") : (joinsNext ? "first" : "single");
                return (
                  <li key={message.id} className={mine ? "v2-dm__msg v2-dm__msg--mine" : "v2-dm__msg"} data-run={run}>
                    {newDay ? <span className="v2-dm__day">{dayLabel(message.createdAt, ja)}</span> : null}
                    {message.previewText ? <span className="v2-dm__bubble">{message.previewText}</span> : null}
                    {message.images?.length ? (
                      <span className="v2-dm__images">
                        {message.images.map((image) => (
                          <a key={image.id} href={image.fullUrl} target="_blank" rel="noreferrer">
                            <img src={image.url} alt={image.altText || (ja ? "添付画像" : "Attached image")} width={image.width} height={image.height} loading="lazy" />
                          </a>
                        ))}
                      </span>
                    ) : null}
                    {!joinsNext ? <small className="v2-dm__meta">{mine ? "" : `${sender?.displayName ?? ""} · `}<V2RelativeTime value={message.createdAt} locale={locale} />{mine && readByPartner && index === messages.length - 1 ? <span className="v2-dm__read">{ja ? " · 既読" : " · Seen"}</span> : null}</small> : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="v2-dm__list v2-dm__list--empty"><p className="v2-dm__none">{ja ? "まだメッセージはありません。最初の一言を送りましょう。" : "No messages yet. Say hello."}</p></div>
          )}

          <form id="v2-dm-composer" className="v2-reply v2-reply--plain" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <div className="v2-dm__modes" role="group" aria-label={ja ? "書き方" : "Composition"}>
              <button type="button" className="v2-action" aria-pressed={mode === "direct"} onClick={() => { setMode("direct"); setApplied(false); dispatchAssist({ type: "candidate_dismissed" }); }}>Direct</button>
              <button type="button" className="v2-action" aria-pressed={mode === "assist"} onClick={() => setMode("assist")}>Assist</button>
              {mode === "assist" ? <span className="v2-dm__hint">{ja ? "候補は「反映」を押すまで送られません。" : "Candidates are not sent until you apply them."}</span> : null}
            </div>
            <textarea
              className="v2-reply__input"
              value={draft}
              maxLength={MESSAGE_MAX}
              rows={3}
              placeholder={ja ? "メッセージを書く" : "Write a message"}
              aria-label={ja ? "メッセージ" : "Message"}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={(event) => {
                /* Enter で送る。Shift+Enter は改行。日本語変換の確定の Enter では送らない。 */
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                send();
              }}
            />
            {mode === "assist" ? (
              <div className="v2-dm__assist">
                {ASSIST_ACTIONS.map((action) => (
                  <button key={action.id} type="button" className="v2-action" disabled={!draft.trim() || assist.status === "generating"} onClick={() => void generate(action.id)}>
                    {ja ? action.ja : action.en}
                  </button>
                ))}
                {assist.status === "generating" ? <span className="v2-dm__hint">{ja ? "候補を作っています…" : "Generating…"}</span> : null}
                {assist.status === "error" ? <span className="v2-error">{assist.message}</span> : null}
                {assist.status === "preview" ? (
                  <div className="v2-dm__candidate">
                    <p className="v2-post__text">{assist.candidate}</p>
                    <button type="button" className="v2-reply__submit" onClick={applyCandidate}>{ja ? "反映" : "Apply"}</button>
                    <button type="button" className="v2-action" onClick={() => dispatchAssist({ type: "candidate_dismissed" })}>{ja ? "捨てる" : "Discard"}</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {images.length ? (
              <ul className="v2-compose__images">
                {images.map((item) => (
                  <li key={item.key} className="v2-compose__image">
                    <img src={item.previewUrl} alt={item.altText || (ja ? "添付予定の画像" : "Image to attach")} />
                    <button type="button" className="v2-action" onClick={() => dropImage(item.key)}>{ja ? "外す" : "Remove"}</button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="v2-reply__footer">
              {!conversation.isE2ee ? (
                <>
                  <input
                    ref={imageInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    onChange={(event) => void pickImages(event.target.files)}
                  />
                  <button type="button" className="v2-action" onClick={() => imageInput.current?.click()} disabled={pending || images.length >= IMAGE_LIMIT}>
                    {ja ? `画像（${images.length}/${IMAGE_LIMIT}）` : `Image (${images.length}/${IMAGE_LIMIT})`}
                  </button>
                </>
              ) : null}
              <span className="v2-reply__remaining" aria-live="polite">{MESSAGE_MAX - draft.length}</span>
              <button type="submit" className="v2-reply__submit" disabled={!canSend || pending}>{ja ? "送る" : "Send"}</button>
            </div>
          </form>
        </>
      ) : (
        <V2Empty
          title={ja ? "会話を選ぶか、新しく始める" : "Pick a conversation or start one"}
          note={ja ? "一覧の連絡先から相手を選ぶと始まります。" : "Choose someone from your contacts to start."}
          action={{ label: ja ? "人を探す" : "Find people", href: "/v2/search?q=%E4%BA%BA" }}
        />
      )}
    </div>
  );
}
