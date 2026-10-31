"use client";
import { withSocialStreamReturn } from "@/lib/social-stream-return";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readCommunityMessageAttempt, type CommunityMessageAttempt } from "@/lib/community-message-attempt";

import { V2Button } from "@/components/v2/v2-button";
import { IMAGE_LIMIT, imageErrorMessage, prepareImage, uploadPickedImages, type PickedImage } from "@/components/v2/v2-image-prepare";
import type { CommunityChannelMessageView } from "@/lib/server/community-page-data";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";
import { CommunityJoinControls, type CommunityJoinMemory } from "@/components/community-join-controls";

/*
 * コミュニティの中。既存の community-workspace.tsx（4,700行）から
 * チャンネルの会話に関わる機能だけを抜いた。
 *
 * 落とさなかったもの: 8秒ごとの取り直し、開いたら自動で既読、2000字、
 * 返信、種別4つ、下書き（既存と同じ鍵 hub.community.draft.{id}.{channel}）、
 * 絵文字の反応3つ、いいね・保存、自分の投稿の編集・削除、通報、
 * 運営の固定、参加・退出・承認待ちの取り消し。
 *
 * まだ無いもの（既存の画面へ渡す）: 画像、投票、予約投稿、解決／締切、
 * 検索と絞り込み、メンバー管理、ガバナンス、トークン、通知設定、
 * チャンネルの作成・編集。docs/HUB_V2_FEATURE_EXTRACTION.md に残してある。
 *
 * 種別の呼び名は既存と同じ（雑談／共同ページ／質問／募集）。変えると
 * v1で付けた札とv2で付けた札が別物に見える。
 */

export type V2CommunityChannel = {
  id: string;
  name: string;
  description: string;
  unreadCount: number;
};

export type V2CommunityWorkspaceData = {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: "public" | "approval" | "private";
  joined: boolean;
  pending: boolean;
  viewerRole: "owner" | "moderator" | "member" | null;
  viewerStatus: "active" | "muted" | "banned" | null;
  memberCount: number;
  channels: V2CommunityChannel[];
};

type Kind = "chat" | "guide" | "question" | "party";

const KINDS: { id: Kind; ja: string; en: string }[] = [
  { id: "chat", ja: "雑談", en: "Chat" },
  { id: "guide", ja: "共同ページ", en: "Guide" },
  { id: "question", ja: "質問", en: "Question" },
  { id: "party", ja: "募集", en: "Party" },
];

const EMOJI = ["👍", "❤️", "🎉"] as const;
const POLL_MS = 8000;
const MAX = 2000;

type Message = CommunityChannelMessageView;

export type V2CommunityMember = {
  id: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
};

/*
 * 一覧のAPIと送信のAPIが返す1件は、頁の初期データより痩せている。
 * 名前・@・顔・返信先・反応・いいねが無く、固定は pinnedAt でしか分からない。
 * 既存の画面もメンバー一覧から名前を引き直していた。ここでも同じことをする。
 *
 * 揃えずに入れると、送った瞬間に画面ごと落ちる（reactions.find）か、
 * 8秒後の取り直しで全員の名前が消える。2026-09-02 に両方起きた。
 */
type RawMessage = Partial<Message> & {
  id: string;
  authorProfileId: string;
  body: string;
  createdAt: string;
  replyToMessageId?: string | null;
  pinnedAt?: string | null;
};

function reconcile(
  raw: RawMessage,
  existing: Message | undefined,
  members: Map<string, V2CommunityMember>,
  siblings: Map<string, RawMessage>,
): Message {
  const author = members.get(raw.authorProfileId);
  const target = raw.replyToMessageId ? siblings.get(raw.replyToMessageId) : undefined;
  const targetAuthor = target ? members.get(target.authorProfileId) : undefined;
  return {
    ...existing,
    ...raw,
    displayName: raw.displayName ?? author?.displayName ?? existing?.displayName ?? "",
    handle: raw.handle ?? author?.handle ?? existing?.handle,
    avatarUrl: raw.avatarUrl ?? author?.avatarUrl ?? existing?.avatarUrl,
    replyTo: raw.replyTo ?? existing?.replyTo ?? (target
      ? { id: target.id, displayName: target.displayName ?? targetAuthor?.displayName ?? "", body: target.body }
      : undefined),
    reactions: raw.reactions ?? existing?.reactions ?? [],
    engagement: raw.engagement ?? existing?.engagement,
    kind: raw.kind ?? existing?.kind ?? "chat",
    pinned: raw.pinned ?? (raw.pinnedAt !== undefined ? Boolean(raw.pinnedAt) : existing?.pinned ?? false),
    workflowStatus: raw.workflowStatus ?? existing?.workflowStatus ?? "open",
  };
}

function reconcileAll(list: RawMessage[], previous: Message[], members: Map<string, V2CommunityMember>): Message[] {
  const known = new Map(previous.map((item) => [item.id, item]));
  const siblings = new Map<string, RawMessage>([...previous, ...list].map((item) => [item.id, item]));
  return list.map((item) => reconcile(item, known.get(item.id), members, siblings));
}

export function V2CommunityWorkspace(props: Parameters<typeof CommunityWorkspaceContent>[0]) {
  const joinMemory = useRef<CommunityJoinMemory>(new Map());
  useEffect(() => { joinMemory.current.clear(); }, [props.viewerId]);
  return <CommunityWorkspaceContent key={JSON.stringify([props.viewerId, props.community.id, props.channel?.id ?? null])} {...props} joinMemory={joinMemory.current}/>;
}

function CommunityWorkspaceContent({
  community,
  channel,
  initialMessages,
  members,
  viewerId,
  locale,
  joinMemory,
  returnTo,
}: {
  community: V2CommunityWorkspaceData;
  channel: V2CommunityChannel | null;
  initialMessages: Message[];
  members: V2CommunityMember[];
  viewerId: string;
  locale: string;
  joinMemory?: CommunityJoinMemory;
  returnTo?: string;
}) {
  const ja = locale === "ja";
  const loginHref = `/v2/auth?next=${encodeURIComponent(withSocialStreamReturn(`/v2/community?${new URLSearchParams({ community: community.id, ...(channel ? { channel: channel.id } : {}) })}`, returnTo))}`;
  const router = useRouter();
  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const [messages, setMessages] = useState<Message[]>(() => reconcileAll(initialMessages, [], memberMap));
  const [membership, setMembership] = useState({ joined: community.joined, pending: community.pending });
  useEffect(() => { setMembership({ joined: community.joined, pending: community.pending }); }, [community.joined, community.pending]);
  const cancellationAttempt = useRef<{ scope: string; id: string } | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  useEffect(() => {
    const changed = () => { joinMemory?.clear(); setShowJoin(false); };
    window.addEventListener("hub-account-changed", changed);
    return () => window.removeEventListener("hub-account-changed", changed);
  }, [joinMemory]);
  const [draft, setDraft] = useState("");
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  /* 画像4枚まで。投稿欄と同じ下ごしらえと送信（v2-image-prepare）。 */
  const [images, setImages] = useState<PickedImage[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const chosen = Array.from(files).slice(0, Math.max(0, IMAGE_LIMIT - images.length));
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
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const dropImage = (key: string) => {
    setImages((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  };
  const [kind, setKind] = useState<Kind>("chat");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState<CommunityMessageAttempt | null>(null);
  const pendingImageKeys = useRef<Set<string>>(new Set());
  const [attemptReady, setAttemptReady] = useState(false);
  const [attemptRestoreFailed, setAttemptRestoreFailed] = useState(false);
  const attemptKey = viewerId && channel ? `hub.community.attempt.${viewerId}.${community.id}.${channel.id}` : null;
  useEffect(() => {
    if (!attemptKey) return;
    try {
      setPendingAttempt(readCommunityMessageAttempt(localStorage.getItem(attemptKey)));
      setAttemptReady(true);
    } catch {
      setAttemptRestoreFailed(true);
      setError(ja ? "保存された投稿を確認できません。ページを再読み込みしてください。" : "Could not restore the pending post. Reload this page.");
    }
  }, [attemptKey, ja]);
  const stopRetry = () => {
    if (!attemptKey || busy) return;
    if (!window.confirm(ja
      ? "この端末の再送記録を消します。投稿はすでに保存されている可能性があります。一覧を確認してから新しく送ってください。下書きと保存済みの投稿は消えません。"
      : "Remove this device's retry record? The post may already be saved. Check the conversation before sending again. Your draft and saved posts will remain.")) return;
    try {
      localStorage.removeItem(attemptKey);
      setPendingAttempt(null);
      pendingImageKeys.current = new Set();
      setAttemptRestoreFailed(false);
      setAttemptReady(true);
      setError(null);
    } catch {
      setError(ja ? "再送記録を消せませんでした。端末の保存設定を確認してください。" : "Could not remove the retry record. Check this device's storage settings.");
    }
  };
  const lastReadRef = useRef<string | null>(null);
  const draftKey = channel ? `hub.community.draft.${community.id}.${channel.id}` : null;

  const canRead = community.visibility !== "private" || membership.joined;
  const canPost = Boolean(viewerId) && membership.joined && community.viewerStatus !== "muted" && community.viewerStatus !== "banned";
  const canModerate = community.viewerRole === "owner" || community.viewerRole === "moderator";

  /* 下書き。鍵は既存と同じにして、v1で書きかけたものがv2でも出るようにする。 */
  useEffect(() => {
    if (!draftKey) return;
    try {
      setDraft(localStorage.getItem(draftKey) ?? "");
      setLoadedDraftKey(draftKey);
    } catch {
      setDraft("");
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || loadedDraftKey !== draftKey) return;
    try {
      if (draft) localStorage.setItem(draftKey, draft);
      else localStorage.removeItem(draftKey);
    } catch {
      /* 保存できない環境では下書きを諦める。書けないことは画面に影響しない。 */
    }
  }, [draft, draftKey, loadedDraftKey]);

  const refresh = useCallback(async () => {
    if (!channel || !canRead) return;
    try {
      const response = await fetch(`/api/communities/${community.id}/channels/${channel.id}/messages`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { messages?: RawMessage[] };
      if (payload.messages) setMessages((previous) => reconcileAll(payload.messages!, previous, memberMap));
    } catch {
      /* 取り直しの失敗は黙る。次の8秒でまた試す。 */
    }
  }, [channel, canRead, community.id, memberMap]);

  /* 8秒ごと。見えていない間は回さない。 */
  useEffect(() => {
    if (!channel || !canRead) return;
    let timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    const onVisible = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [channel, canRead, refresh]);

  /* 開いたら既読。同じ最後の1件を二度送らない。 */
  useEffect(() => {
    if (!channel || !membership.joined || !messages.length) return;
    const last = messages[messages.length - 1].id;
    if (lastReadRef.current === last) return;
    lastReadRef.current = last;
    void fetch(`/api/communities/${community.id}/channels/${channel.id}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ last_message_id: last }),
    }).catch(() => undefined);
  }, [channel, community.id, membership.joined, messages]);

  const fail = (message: string) => setError(message);

  const submit = async (event: { preventDefault(): void }, retry?: CommunityMessageAttempt) => {
    event.preventDefault();
    if (!channel || !canPost || busy || !attemptReady || !attemptKey) return;
    if (pendingAttempt && !retry) {
      fail(ja ? "先ほどの投稿の送信結果を確認してください。" : "Check the previous post before sending another.");
      return;
    }
    const sentDraft = draft;
    const sentDraftKey = draftKey;
    const body = sentDraft.trim();
    if (!retry && ((!body && !images.length) || body.length > MAX)) return;
    setBusy(true);
    try {
      const attempt = retry ?? {
        client_request_id: crypto.randomUUID(), body, kind,
        reply_to_message_id: replyTo?.id ?? null,
        image_ids: images.length ? await uploadPickedImages(images, ja) : [],
      };
      localStorage.setItem(attemptKey, JSON.stringify(attempt));
      if (!retry) pendingImageKeys.current = new Set(images.map(image => image.key));
      setPendingAttempt(attempt);
      const response = await fetch(`/api/communities/${community.id}/channels/${channel.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attempt),
      });
      const payload = await response.json().catch(() => ({})) as { message?: RawMessage; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error || String(response.status));
      /* 8秒の取り直しが先に同じ1件を持ってくることがある。二重に足さない。 */
      setMessages((previous) => previous.some((item) => item.id === payload.message!.id)
        ? previous
        : [...previous, ...reconcileAll([payload.message!], previous, memberMap)]);
      localStorage.removeItem(attemptKey);
      setPendingAttempt(null);
      setDraft((current) => current.trim() === attempt.body ? "" : current);
      // アンマウント後に成功が遅れて届くと setDraft が効かず、送信済み本文が
      // 下書きとして残る。保存値が送信時の下書きと一致するときだけ消す。
      try {
        if (sentDraftKey && localStorage.getItem(sentDraftKey) === sentDraft) localStorage.removeItem(sentDraftKey);
      } catch { /* 無視 */ }
      const sentImageKeys = pendingImageKeys.current;
      setImages(current => {
        current.filter(item => sentImageKeys.has(item.key)).forEach(item => URL.revokeObjectURL(item.previewUrl));
        return current.filter(item => !sentImageKeys.has(item.key));
      });
      pendingImageKeys.current = new Set();
      setReplyTo(current => current?.id === attempt.reply_to_message_id ? null : current);
      setError(null);
    } catch (caught) {
      fail(caught instanceof Error && caught.message ? caught.message : (ja ? "送信できませんでした。" : "Could not send."));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!channel || !editing || busy) return;
    const body = editing.body.trim();
    if (!body || body.length > MAX) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/communities/${community.id}/channels/${channel.id}/messages/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      setEditing(null);
      setError(null);
      await refresh();
    } catch (caught) {
      fail(caught instanceof Error && caught.message ? caught.message : (ja ? "編集できませんでした。" : "Could not edit."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (message: Message) => {
    if (!channel || busy) return;
    if (!window.confirm(ja ? "この投稿を削除しますか。" : "Delete this message?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/communities/${community.id}/channels/${channel.id}/messages/${message.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
      setError(null);
    } catch (caught) {
      fail(caught instanceof Error && caught.message ? caught.message : (ja ? "削除できませんでした。" : "Could not delete."));
    } finally {
      setBusy(false);
    }
  };

  const pin = async (message: Message) => {
    if (!channel || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/communities/${community.id}/channels/${channel.id}/messages/${message.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: !message.pinned }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      setError(null);
      await refresh();
    } catch (caught) {
      fail(caught instanceof Error && caught.message ? caught.message : (ja ? "固定を変えられませんでした。" : "Could not change the pin."));
    } finally {
      setBusy(false);
    }
  };

  const report = async (message: Message, reason: string) => {
    if (!channel || !reason) return;
    try {
      const response = await fetch(`/api/communities/${community.id}/channels/${channel.id}/messages/${message.id}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      setError(ja ? "通報を受け付けました。" : "Report received.");
    } catch (caught) {
      fail(caught instanceof Error && caught.message ? caught.message : (ja ? "通報を送れませんでした。" : "Could not send the report."));
    }
  };

  /* 反応は楽観的に反映して、失敗したら取り直す。 */
  const react = async (message: Message, emoji: typeof EMOJI[number]) => {
    if (!channel || !canPost) return;
    setMessages((previous) => previous.map((item) => {
      if (item.id !== message.id) return item;
      const found = item.reactions.find((reaction) => reaction.emoji === emoji);
      const reactions = found
        ? item.reactions.map((reaction) => reaction.emoji === emoji
          ? { ...reaction, reacted: !reaction.reacted, count: reaction.count + (reaction.reacted ? -1 : 1) }
          : reaction)
        : [...item.reactions, { emoji, count: 1, reacted: true }];
      return { ...item, reactions: reactions.filter((reaction) => reaction.count > 0) };
    }));
    try {
      const response = await fetch(`/api/communities/${community.id}/channels/${channel.id}/messages/${message.id}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      fail(ja ? "反応を送れませんでした。" : "Could not react.");
      await refresh();
    }
  };

  /*
   * いいね・保存は楽観的に反映し、失敗したら**その1件だけ**元へ戻す。
   * 一覧を取り直して戻そうとすると、一覧のAPIは engagement を返さないので
   * 楽観的な値がそのまま残る（自分の投稿への「いいね」が400なのに付いたままに
   * なった）。
   */
  const engage = async (message: Message, kindOf: "reaction" | "bookmark") => {
    if (!viewerId || !message.engagement) return;
    const snapshot = message.engagement;
    const wasOn = kindOf === "reaction" ? message.engagement.liked : message.engagement.bookmarked;
    setMessages((previous) => previous.map((item) => item.id === message.id && item.engagement
      ? {
        ...item,
        engagement: {
          ...item.engagement,
          liked: kindOf === "reaction" ? !wasOn : item.engagement.liked,
          likeCount: kindOf === "reaction" ? item.engagement.likeCount + (wasOn ? -1 : 1) : item.engagement.likeCount,
          bookmarked: kindOf === "bookmark" ? !wasOn : item.engagement.bookmarked,
        },
      }
      : item));
    try {
      const response = await fetch(`/api/engagements/${kindOf}`, {
        method: wasOn ? "DELETE" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: "community_message",
          target_id: message.id,
          ...(kindOf === "reaction" ? { kind: "like" } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
    } catch (caught) {
      setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, engagement: snapshot } : item));
      fail(caught instanceof Error && caught.message ? caught.message : (ja ? "反映できませんでした。" : "That did not go through."));
    }
  };

  const toggleMembership = async () => {
    if (!viewerId || busy) return;
    if (!membership.joined && !membership.pending) { setShowJoin(true); return; }
    setBusy(true);
    try {
      if (membership.pending) {
        const scope = JSON.stringify([viewerId, community.id]);
        if (cancellationAttempt.current?.scope !== scope) {
          cancellationAttempt.current = { scope, id: crypto.randomUUID() };
        }
        const response = await fetch(`/api/communities/${community.id}/membership`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: cancellationAttempt.current.id }),
        });
        const payload = await response.json().catch(() => ({})) as { error?: string; currentMembership?: { joined?: unknown; pending?: unknown } };
        if (!response.ok) throw new Error(payload.error || String(response.status));
        if (typeof payload.currentMembership?.joined !== "boolean" || typeof payload.currentMembership.pending !== "boolean") {
          throw new Error(ja ? "現在の参加状態を確認できませんでした。再試行してください。" : "Could not confirm current membership. Please retry.");
        }
        cancellationAttempt.current = null;
        setMembership({ joined: payload.currentMembership.joined, pending: payload.currentMembership.pending });
      } else {
        if (membership.joined && !window.confirm(ja ? `${community.name} から退出しますか。` : `Leave ${community.name}?`)) return;
        const response = await fetch(`/api/communities/${community.id}/membership`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ joined: !membership.joined }),
        });
        const payload = await response.json().catch(() => ({})) as { joined?: boolean; pending?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error || String(response.status));
        setMembership({ joined: Boolean(payload.joined), pending: Boolean(payload.pending) });
      }
      setError(null);
      router.refresh();
    } catch (caught) {
      fail(caught instanceof Error && caught.message ? caught.message : (ja ? "参加状態を変えられませんでした。" : "Could not change membership."));
    } finally {
      setBusy(false);
    }
  };

  const membershipLabel = membership.pending
    ? (ja ? "承認待ち（取り消す）" : "Pending (cancel)")
    : membership.joined
      ? (community.viewerRole === "owner" ? (ja ? "所有者" : "Owner") : (ja ? "退出" : "Leave"))
      : community.visibility === "private"
        ? (ja ? "招待制" : "Invite only")
        : community.visibility === "approval"
          ? (ja ? "参加を申請" : "Request to join")
          : (ja ? "参加" : "Join");
  const membershipDisabled = !viewerId || busy || community.viewerRole === "owner" || (community.visibility === "private" && !membership.joined) || community.viewerStatus === "banned";

  return (
    <div className="v2-cws">
      <div className="v2-cws__head">
        <div className="v2-cws__about">
          <p className="v2-prose">{community.description}</p>
          <p className="v2-card__meta">
            <span>{ja ? `${community.memberCount}人` : `${community.memberCount} members`}</span>
            <span>{community.visibility === "public" ? (ja ? "公開" : "Public") : community.visibility === "approval" ? (ja ? "承認制" : "Approval") : (ja ? "非公開" : "Private")}</span>
            {community.viewerStatus === "muted" ? <span className="v2-badge v2-badge--warn">{ja ? "ミュート中" : "Muted"}</span> : null}
            {community.viewerStatus === "banned" ? <span className="v2-badge v2-badge--warn">{ja ? "参加停止" : "Banned"}</span> : null}
          </p>
        </div>
        {!viewerId ? <Link className="v2-toggle v2-toggle--text" href={loginHref}>{ja ? "ログインして参加" : "Log in to join"}</Link> : <button type="button" className="v2-toggle v2-toggle--text" disabled={membershipDisabled} onClick={() => void toggleMembership()}>
          {membershipLabel}
        </button>}
      </div>

      {showJoin && <CommunityJoinControls communityId={community.id} actorId={viewerId} memory={joinMemory} onChanged={state => {
        setMembership({ joined: state.joined, pending: state.pending });
        router.refresh();
      }}/>}
      {error ? <p className="v2-error" role="status">{error}</p> : null}

      {!channel ? (
        <p className="v2-note">{ja ? "チャンネルがまだありません。" : "No channels yet."}</p>
      ) : !canRead ? (
        <p className="v2-note">{ja ? "非公開のコミュニティです。参加すると読めます。" : "This community is private. Join to read."}</p>
      ) : (
        <>
          {channel.description ? <p className="v2-note">{channel.description}</p> : null}

          {messages.length ? (
            <ol className="v2-cmsgs">
              {messages.map((message) => {
                const own = Boolean(viewerId) && message.authorProfileId === viewerId;
                const kindLabel = KINDS.find((item) => item.id === (message.kind ?? "chat"));
                return (
                  <li key={message.id} id={`message-${message.id}`} className={message.pinned ? "v2-cmsg v2-cmsg--pinned" : "v2-cmsg"}>
                    {message.avatarUrl
                      ? <img className="v2-post__avatar" src={message.avatarUrl} alt="" width={44} height={44} />
                      : <span className="v2-post__avatar" aria-hidden="true" />}
                    <div className="v2-post__body">
                      <header className="v2-post__header">
                        {message.handle
                          ? <Link className="v2-post__name" href={`/v2/profile/${message.handle}`}>{message.displayName}</Link>
                          : <span className="v2-post__name">{message.botName ?? message.displayName}</span>}
                        {message.handle ? <span className="v2-post__handle">@{message.handle}</span> : null}
                        {kindLabel && kindLabel.id !== "chat" ? <span className="v2-badge">{ja ? kindLabel.ja : kindLabel.en}</span> : null}
                        {message.pinned ? <span className="v2-badge">{ja ? "固定" : "Pinned"}</span> : null}
                        {message.workflowStatus && message.workflowStatus !== "open"
                          ? <span className="v2-badge v2-badge--best">{message.workflowStatus === "resolved" ? (ja ? "解決" : "Resolved") : (ja ? "締切" : "Closed")}</span>
                          : null}
                        <span className="v2-post__time"><V2RelativeTime value={message.createdAt} locale={locale} /></span>
                        {message.editedAt ? <span className="v2-post__time">{ja ? "編集済み" : "edited"}</span> : null}
                      </header>

                      {message.replyTo ? (
                        <a className="v2-tpost__reply-to" href={`#message-${message.replyTo.id}`}>
                          {ja ? "返信先" : "Replying to"} {message.replyTo.displayName}: {message.replyTo.body.slice(0, 60)}
                        </a>
                      ) : null}

                      {editing?.id === message.id ? (
                        <div className="v2-reply v2-reply--plain">
                          <textarea
                            className="v2-reply__input"
                            value={editing.body}
                            maxLength={MAX}
                            rows={3}
                            onChange={(event) => setEditing({ id: message.id, body: event.target.value })}
                            aria-label={ja ? "本文を編集" : "Edit message"}
                          />
                          <div className="v2-reply__footer">
                            <span className="v2-reply__remaining">{MAX - editing.body.length}</span>
                            <button type="button" className="v2-action" onClick={() => setEditing(null)}>{ja ? "やめる" : "Cancel"}</button>
                            <button type="button" className="v2-reply__submit" disabled={busy || !editing.body.trim()} onClick={() => void saveEdit()}>{ja ? "保存" : "Save"}</button>
                          </div>
                        </div>
                      ) : (
                        <p className="v2-post__text">{message.body}</p>
                      )}

                      {message.images?.length ? (
                        <div className="v2-post__images">
                          {message.images.map((image) => (
                            <img key={image.id} src={image.url} width={image.width} height={image.height} alt={image.altText} loading="lazy" />
                          ))}
                        </div>
                      ) : null}

                      <div className="v2-post__actions">
                        {EMOJI.map((emoji) => {
                          const reaction = message.reactions.find((item) => item.emoji === emoji);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              className="v2-action"
                              aria-pressed={Boolean(reaction?.reacted)}
                              aria-label={`${emoji} ${reaction?.count ?? 0}`}
                              disabled={!canPost}
                              onClick={() => void react(message, emoji)}
                            >
                              {emoji}{reaction?.count ? ` ${reaction.count}` : ""}
                            </button>
                          );
                        })}
                        {message.engagement ? (
                          <>
                            <V2Button icon="heart" label={ja ? "いいね" : "Like"} count={message.engagement.likeCount || undefined} pressed={message.engagement.liked} disabled={!viewerId} onClick={() => void engage(message, "reaction")} />
                            <V2Button icon="bookmark" label={message.engagement.bookmarked ? (ja ? "保存済み" : "Saved") : (ja ? "保存" : "Save")} pressed={message.engagement.bookmarked} disabled={!viewerId} onClick={() => void engage(message, "bookmark")} />
                          </>
                        ) : null}
                        {canPost ? <V2Button icon="reply" label={ja ? "返信" : "Reply"} onClick={() => { setReplyTo(message); document.getElementById("v2-community-composer")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} /> : null}
                        {own ? (
                          <>
                            <V2Button icon="edit" label={ja ? "編集" : "Edit"} onClick={() => setEditing({ id: message.id, body: message.body })} />
                            <V2Button icon="trash" label={ja ? "削除" : "Delete"} onClick={() => void remove(message)} />
                          </>
                        ) : null}
                        {canModerate ? <V2Button icon="pin" label={message.pinned ? (ja ? "固定を外す" : "Unpin") : (ja ? "固定" : "Pin")} pressed={Boolean(message.pinned)} onClick={() => void pin(message)} /> : null}
                        {!own && membership.joined ? (
                          <select
                            className="v2-action v2-action--select"
                            aria-label={ja ? "通報" : "Report"}
                            defaultValue=""
                            onChange={(event) => { void report(message, event.target.value); event.target.value = ""; }}
                          >
                            <option value="">{ja ? "通報…" : "Report…"}</option>
                            <option value="spam">{ja ? "スパム" : "Spam"}</option>
                            <option value="harassment">{ja ? "嫌がらせ" : "Harassment"}</option>
                            <option value="other">{ja ? "その他" : "Other"}</option>
                          </select>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="v2-note">{ja ? "まだ投稿がありません。" : "No messages yet."}</p>
          )}

          {canPost ? (
            <form id="v2-community-composer" className="v2-reply v2-reply--plain" onSubmit={(event) => void submit(event)}>
              {pendingAttempt ? <div className="v2-note" role="status">
                <p>{ja ? "送信結果を確認中の投稿" : "Post awaiting confirmation"}: {pendingAttempt.body.slice(0, 120)}</p>
                <button type="button" className="v2-card__link" disabled={busy} onClick={(event) => void submit(event, pendingAttempt)}>{ja ? "同じ投稿を再送して確認" : "Retry this post"}</button>
                <button type="button" className="v2-card__link" disabled={busy} onClick={stopRetry}>{ja ? "再送をやめる" : "Stop retrying"}</button>
              </div> : null}
              {attemptRestoreFailed ? <p className="v2-note"><button type="button" className="v2-card__link" disabled={busy} onClick={stopRetry}>{ja ? "読み取れない再送記録を消す" : "Remove unreadable retry record"}</button></p> : null}
              {replyTo ? (
                <p className="v2-note">
                  {ja ? "返信先" : "Replying to"} {replyTo.displayName}: {replyTo.body.slice(0, 60)}{" "}
                  <button type="button" className="v2-card__link" onClick={() => setReplyTo(null)}>{ja ? "解除" : "Clear"}</button>
                </p>
              ) : null}
              <textarea
                className="v2-reply__input"
                value={draft}
                maxLength={MAX}
                rows={3}
                placeholder={ja ? `#${channel.name} に書く` : `Write in #${channel.name}`}
                aria-label={ja ? "メッセージ" : "Message"}
                onChange={(event) => setDraft(event.target.value)}
              />
              {images.length ? (
                <ul className="v2-compose__images">
                  {images.map((item) => (
                    <li key={item.key} className="v2-compose__image">
                      <img src={item.previewUrl} alt="" width={item.thumbnailWidth} height={item.thumbnailHeight} />
                      <input
                        type="text"
                        value={item.altText}
                        maxLength={200}
                        placeholder={ja ? "画像の説明（読み上げ用）" : "Describe the image"}
                        aria-label={ja ? "画像の説明" : "Image description"}
                        onChange={(event) => setImages((current) => current.map((entry) => entry.key === item.key ? { ...entry, altText: event.target.value } : entry))}
                      />
                      <V2Button icon="close" label={ja ? "画像を外す" : "Remove image"} onClick={() => dropImage(item.key)} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="v2-reply__footer">
                <label className="v2-reply__identity">
                  <span className="v2-sr">{ja ? "種別" : "Kind"}</span>
                  <select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
                    {KINDS.map((item) => <option key={item.id} value={item.id}>{ja ? item.ja : item.en}</option>)}
                  </select>
                </label>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => void pickImages(event.target.files)} />
                <V2Button icon="plus" label={ja ? `画像を足す（${images.length}/${IMAGE_LIMIT}）` : `Add image (${images.length}/${IMAGE_LIMIT})`} disabled={busy || images.length >= IMAGE_LIMIT} onClick={() => fileInput.current?.click()} />
                <span className="v2-reply__remaining" aria-live="polite">{MAX - draft.length}</span>
                <button type="submit" className="v2-reply__submit" disabled={busy || (!draft.trim() && !images.length)}>{ja ? "送る" : "Send"}</button>
              </div>
            </form>
          ) : viewerId ? (
            <p className="v2-note">
              {community.viewerStatus === "muted"
                ? (ja ? "ミュート中のため投稿できません。" : "You are muted here.")
                : community.viewerStatus === "banned"
                  ? (ja ? "このコミュニティでは投稿できません。" : "You cannot post here.")
                  : (ja ? "参加すると投稿できます。" : "Join to post.")}
            </p>
          ) : (
            <p className="v2-note v2-reply-auth">
              <Link href={loginHref}>{ja ? "ログイン" : "Sign in"}</Link>{ja ? "すると参加できます。" : " to join."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
