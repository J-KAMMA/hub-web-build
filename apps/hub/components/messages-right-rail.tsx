"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DirectMessage, MessageConversation, Profile } from "@/lib/domain";

type MessagesPayload = {
  currentProfileId: string;
  conversations: MessageConversation[];
  messages: DirectMessage[];
  profiles: Profile[];
};

const EMPTY_PAYLOAD: MessagesPayload = {
  currentProfileId: "",
  conversations: [],
  messages: [],
  profiles: [],
};

export function MessagesRightRail({ expectedProfileId }: { expectedProfileId?: string }) {
  return <MessagesRightRailSession key={expectedProfileId === undefined ? "session" : `profile:${expectedProfileId}`} expectedProfileId={expectedProfileId} />;
}

function MessagesRightRailSession({ expectedProfileId }: { expectedProfileId?: string }) {
  const [data, setData] = useState<MessagesPayload>(EMPTY_PAYLOAD);
  const [activeId, setActiveId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sending, setSending] = useState(false);
  const life = useRef({ mounted: false, epoch: 0, generation: 0, profileId: "", activeId: "", sending: false });
  const controllers = useRef(new Set<AbortController>());
  const reader = useRef<AbortController | null>(null);
  const draftVersions = useRef(new Map<string, number>());

  const invalidate = useCallback(() => {
    life.current.epoch++;
    life.current.generation++;
    life.current.profileId = "";
    life.current.activeId = "";
    life.current.sending = false;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    draftVersions.current.clear();
    setData(EMPTY_PAYLOAD);
    setActiveId("");
    setDrafts({});
    setSending(false);
  }, []);

  const load = useCallback(async (conversationId?: string) => {
    const epoch = life.current.epoch;
    const generation = ++life.current.generation;
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    controllers.current.add(controller);
    const current = () => life.current.mounted && life.current.epoch === epoch && life.current.generation === generation;
    setStatus("loading");
    try {
      const query = conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : "";
      const response = await fetch(`/api/messages/conversations${query}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) {
        invalidate();
        setStatus("error");
        return false;
      }
      if (!response.ok) throw new Error("messages_unavailable");
      const payload = await response.json() as MessagesPayload;
      if (!current()) return false;
      if (!payload.currentProfileId || (expectedProfileId !== undefined && payload.currentProfileId !== expectedProfileId)
        || (life.current.profileId && payload.currentProfileId !== life.current.profileId)) {
        invalidate();
        setStatus("error");
        return false;
      }
      life.current.profileId = payload.currentProfileId;
      const selected = conversationId ?? life.current.activeId;
      life.current.activeId = payload.conversations.some((conversation) => conversation.id === selected)
        ? selected : payload.conversations[0]?.id ?? "";
      setData(payload);
      setActiveId(life.current.activeId);
      setStatus("ready");
      return true;
    } catch {
      if (current()) setStatus("error");
      return false;
    } finally {
      controllers.current.delete(controller);
    }
  }, [expectedProfileId, invalidate]);

  useEffect(() => {
    life.current.mounted = true;
    const changed = () => { invalidate(); void load(); };
    window.addEventListener("hub-account-changed", changed);
    void load();
    return () => {
      life.current.mounted = false;
      life.current.epoch++;
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
      window.removeEventListener("hub-account-changed", changed);
    };
  }, [invalidate, load]);

  const profiles = useMemo(() => new Map(data.profiles.map((profile) => [profile.id, profile])), [data.profiles]);
  const activeConversation = data.conversations.find((conversation) => conversation.id === activeId);
  const activeMessages = data.messages.filter((message) => message.conversationId === activeId);
  const draft = drafts[activeId] ?? "";

  const partnerFor = (conversation: MessageConversation) => {
    const partnerId = conversation.participantIds.find((id) => id !== data.currentProfileId) ?? "";
    return profiles.get(partnerId);
  };

  const selectConversation = async (conversationId: string) => {
    const epoch = life.current.epoch;
    life.current.activeId = conversationId;
    setActiveId(conversationId);
    if (!await load(conversationId) || life.current.epoch !== epoch || life.current.activeId !== conversationId) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    await fetch(`/api/messages/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST", signal: controller.signal })
      .catch(() => undefined).finally(() => controllers.current.delete(controller));
  };

  const send = async () => {
    const body = draft.trim();
    if (!activeId || !body || life.current.sending || !life.current.profileId) return;
    const conversationId = activeId;
    const profileId = life.current.profileId;
    const epoch = life.current.epoch;
    const version = draftVersions.current.get(conversationId) ?? 0;
    const controller = new AbortController();
    controllers.current.add(controller);
    const current = () => life.current.mounted && life.current.epoch === epoch;
    life.current.sending = true;
    setSending(true);
    try {
      const response = await fetch(`/api/messages/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-expected-viewer": profileId },
        signal: controller.signal,
        body: JSON.stringify({
          preview_text: body,
          composition_mode: "direct",
          human_approved: false,
        }),
      });
      if (!current()) return;
      const actorChanged = response.status === 409
        && (await response.json().catch(() => null))?.code === "direct_message_actor_changed";
      if (!current()) return;
      if (response.status === 401 || response.status === 403 || actorChanged) {
        invalidate();
        setStatus("error");
        return;
      }
      if (!response.ok) throw new Error("message_send_failed");
      if ((draftVersions.current.get(conversationId) ?? 0) === version) {
        setDrafts((previous) => ({ ...previous, [conversationId]: "" }));
      }
      if (life.current.activeId === conversationId) await load(conversationId);
    } catch {
      if (current() && life.current.activeId === conversationId) setStatus("error");
    } finally {
      controllers.current.delete(controller);
      if (current()) {
        life.current.sending = false;
        setSending(false);
      }
    }
  };

  if (status === "loading" && !data.conversations.length) {
    return <div className="right-rail-state" role="status">メッセージを読み込み中…</div>;
  }

  if (status === "error" && !data.conversations.length) {
    return <div className="right-rail-state" role="alert"><strong>メッセージを読み込めませんでした</strong><button type="button" onClick={() => void load()}>再試行</button></div>;
  }

  return (
    <section className="messages-right-rail" aria-label="メッセージ">
      <div className="messages-right-rail__conversations" aria-label="会話一覧">
        {data.conversations.length ? data.conversations.map((conversation) => {
          const partner = partnerFor(conversation);
          const latest = data.messages.filter((message) => message.conversationId === conversation.id).at(-1);
          const unread = conversation.unreadCountByProfileId[data.currentProfileId] ?? 0;
          return (
            <button
              type="button"
              key={conversation.id}
              className={conversation.id === activeId ? "is-active" : ""}
              aria-pressed={conversation.id === activeId}
              onClick={() => void selectConversation(conversation.id)}
            >
              <span>{partner?.avatarUrl ? <img src={partner.avatarUrl} alt="" /> : (partner?.displayName[0] ?? "?")}</span>
              <span><strong>{partner?.displayName ?? "会話"}</strong><small>{latest?.previewText ?? "メッセージはありません"}</small></span>
              {unread > 0 ? <b aria-label={`${unread}件の未読`}>{unread}</b> : null}
            </button>
          );
        }) : <p>会話はまだありません。</p>}
      </div>

      {activeConversation ? (
        <div className="messages-right-rail__thread">
          <div className="messages-right-rail__messages">
            {activeMessages.slice(-20).map((message) => (
              <p key={message.id} className={message.senderProfileId === data.currentProfileId ? "is-mine" : ""}>
                {message.previewText}
              </p>
            ))}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea value={draft} onChange={(event) => {
              const text = event.target.value;
              draftVersions.current.set(activeId, (draftVersions.current.get(activeId) ?? 0) + 1);
              setDrafts((previous) => ({ ...previous, [activeId]: text }));
            }} placeholder="返信を書く" aria-label="返信" rows={2} />
            <button type="submit" disabled={!draft.trim() || sending}>{sending ? "送信中…" : "送信"}</button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
