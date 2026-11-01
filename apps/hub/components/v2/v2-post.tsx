"use client";

import Link from "next/link";
import { V2TagChipRow } from "@/components/v2/v2-tag-chip";
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";

import type { AppShellTimelinePost } from "@/lib/server/app-shell-data";
import { Avatar } from "@/components/v2/ui";
import { V2Button } from "@/components/v2/v2-button";
import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import { V2LinkCard } from "@/components/v2/v2-link-card";
import { V2GatedRefreshCard } from "@/components/v2/v2-gated-refresh-card";
import { V2GatedPostCompact } from "@/components/v2/v2-gated-post-compact";
import type { GateAccessState } from "@/lib/server/gated-content";
import { shouldOfferTranslation } from "@/components/translated-text";
import type { HubLocale } from "@/lib/i18n";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";
import { HUB_AI_CONTEXT_EVENT, type HubAiContext } from "@/lib/ai-context";
import { withSocialStreamReturn } from "@/lib/social-stream-return";
import { splitPostBody } from "@/lib/post-body-format";
import { V2ImageLightbox } from "@/components/v2/v2-image-lightbox";

/* サーバーは札の種類を "Quote" / "Repost" で返す。読む人の言葉に直す（知らない値はそのまま）。 */
export function referencedKindLabel(label: string, ja: boolean): string {
  const kind = label.trim().toLowerCase();
  if (kind === "quote") return ja ? "引用" : "Quote";
  if (kind === "repost") return ja ? "リポスト" : "Repost";
  if (kind === "reply") return ja ? "返信先" : "Reply to";
  return label;
}

/*
 * 投稿1件。フィードでも投稿詳細でも同じものを使う。
 * 見た目を2か所に書くと、片方だけ直したときに静かにずれる。
 *
 * 既存で潰れていたものはここで直っている。
 *   - 見出し行は折り返す。狭い枠でも名前が3字にならない
 *   - 本文は46emで止まる
 *   - 操作は記号の列。25pxへ縮めて重ねる必要がない
 *
 * 操作（既存の engagement-bar.tsx / post-context-actions.tsx から機能だけを抜いた）:
 *   返信（詳細へ）・リポスト／引用（リポストのメニューから選択）・
 *   いいね・保存・共有（navigator.share か複製）・
 *   ••• に 自分: 編集（PATCH）・削除（DELETE） / 他人: ミュート・ブロック
 *   （PATCH /api/profile/safety）・通報（POST /api/social/posts/{id}/report、理由8種＋500字）
 *
 * まだ無いもの: Hubpediaへ渡す・「減らす」「非表示」。
 * docs/HUB_V2_FEATURE_EXTRACTION.md に残してある。
 */

/* 本文。連続する空行は詰め、URLは短い読める名前にする（href は元のまま。保存された本文は変えない）。 */
function V2PostBody({ body }: { body: string }) {
  const [hubHost, setHubHost] = useState<string | null>(null);
  useEffect(() => { setHubHost(window.location.hostname.toLowerCase()); }, []);
  return (
    <>
      {splitPostBody(body, hubHost).map((part, index) => part.type === "text"
        ? <span key={index}>{part.text}</span>
        : (
          <a
            key={index}
            className={part.internal ? "v2-post__inline-link v2-post__inline-link--hub" : "v2-post__inline-link"}
            href={part.href}
            title={part.href}
            {...(part.internal ? {} : { target: "_blank", rel: "noopener noreferrer nofollow ugc" })}
          >
            {part.kindLabel ? <span className="v2-post__inline-kind">{part.kindLabel}</span> : null}
            {part.label}
          </a>
        ))}
    </>
  );
}

export type V2PostData = AppShellTimelinePost & {
  referenced?: {
    label: string;
    title: string;
    body: string;
    href: string;
    contextLabel?: string;
  } | null;
  repostCount?: number;
  quoteRepostCount?: number;
  viewerRepostId?: string | null;
  /* 閲覧条件つき。サーバーが本文を外して付ける。 */
  accessGate?: GateAccessState;
};

/*
 * 画面に出している値。押した瞬間に変わり、サーバーの確定値（confirmed）とは別に持つ。
 * 失敗したら confirmed へ戻す。押している間も操作は止めない。
 */
type EngagementState = {
  likeCount: number;
  liked: boolean;
  bookmarked: boolean;
  repostCount: number;
  reposted: boolean;
};

type Confirmed = {
  likeCount: number;
  liked: boolean;
  bookmarked: boolean;
  repostCount: number;
  repostId: string | null;
};

/* おすすめの調整。行ごとの小さな札にせず、「…」の中に入れる。 */
export type V2PostDiscovery = {
  reason: string;
  dismiss: () => void;
  reduceAuthor?: () => void;
  restoreAuthor?: () => void;
};

/* 画像1枚に添える srcset。縮小版は端末側で長辺480に作られる（v2-image-prepare.ts）。 */
const THUMBNAIL_LONG_EDGE = 480;
function imageSources(image: { url: string; fullUrl?: string; width: number; height: number }) {
  const fullUrl = image.fullUrl ?? (image.url.includes("variant=thumbnail") ? image.url.replace("variant=thumbnail", "variant=full") : undefined);
  if (!fullUrl || !image.width || !image.height) return { src: image.url, srcSet: undefined };
  const scale = Math.min(1, THUMBNAIL_LONG_EDGE / Math.max(image.width, image.height));
  const thumbWidth = Math.max(1, Math.round(image.width * scale));
  if (thumbWidth >= image.width) return { src: image.url, srcSet: undefined };
  return { src: image.url, srcSet: `${image.url} ${thumbWidth}w, ${fullUrl} ${image.width}w` };
}

/* 拡大表示で使う大きい方の画像。縮小版の URL なら同じ画像の full を指す。 */
function fullImageUrl(image: { url: string; fullUrl?: string }): string {
  return image.fullUrl ?? (image.url.includes("variant=thumbnail") ? image.url.replace("variant=thumbnail", "variant=full") : image.url);
}

/*
 * 投稿の札には、本文のハッシュタグのほかに、投稿先（public / followers）が
 * 仕組みの都合で混ざる。読む人に「#public」は意味が無いので出さない。
 * 言語（日本語・英語）は検索で使えるので残す。
 */
const DESTINATION_TAGS = new Set(["public", "followers"]);

function visibleTags(tags: string[] | undefined): string[] {
  return (tags ?? []).filter((tag) => !DESTINATION_TAGS.has(tag.toLowerCase()));
}

const REPORT_REASONS: { id: string; ja: string; en: string }[] = [
  { id: "spam", ja: "スパム", en: "Spam" },
  { id: "harassment", ja: "嫌がらせ", en: "Harassment" },
  { id: "sexual", ja: "性的な内容", en: "Sexual content" },
  { id: "violence", ja: "暴力", en: "Violence" },
  { id: "image_safety", ja: "画像の安全", en: "Image safety" },
  { id: "copyright", ja: "著作権", en: "Copyright" },
  { id: "privacy", ja: "個人情報", en: "Privacy" },
  { id: "other", ja: "その他", en: "Other" },
];

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string | { message?: string } };
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || String(response.status));
  }
  return payload;
}

export function V2Post({
  post,
  viewerId,
  locale,
  emphasized = false,
  onError,
  onRemoved,
  onCreated,
  onBookmarkChanged,
  returnTo,
  discovery,
  videoOwnerHide,
}: {
  post: V2PostData;
  /* おすすめの理由と「興味なし」など。あれば「…」の中に出す。 */
  discovery?: V2PostDiscovery;
  viewerId: string;
  locale: string;
  /* 投稿詳細の主役だけ、本文をひと回り大きく出す。 */
  emphasized?: boolean;
  onError?: (message: string | null) => void;
  /* 自分で削除したとき。一覧はこれで行を消す。 */
  onRemoved?: (postId: string) => void;
  /* 引用リポストを作ったとき。一覧はこれで先頭に足せる。 */
  onCreated?: (post: V2PostData) => void;
  onBookmarkChanged?: () => void;
  returnTo?: string;
  /* 動画の持ち主だけ。コメントを非表示にする・戻す（「…」の中に出す）。 */
  videoOwnerHide?: { hidden: boolean; onToggle: (postId: string, hide: boolean) => Promise<void> };
}) {
  const ja = locale === "ja";
  const [state, setState] = useState<EngagementState>({
    likeCount: post.likeCount,
    liked: post.viewerReaction === "like",
    bookmarked: post.bookmarked,
    repostCount: post.repostCount ?? 0,
    reposted: Boolean(post.viewerRepostId),
  });
  /* 画面の値（view）とサーバーの確定値（confirmed）。連打は最後の状態だけを送る。 */
  const view = useRef(state);
  const confirmed = useRef<Confirmed>({
    likeCount: post.likeCount,
    liked: post.viewerReaction === "like",
    bookmarked: post.bookmarked,
    repostCount: post.repostCount ?? 0,
    repostId: post.viewerRepostId ?? null,
  });
  const running = useRef({ reaction: false, bookmark: false, repost: false });
  const [pop, setPop] = useState(false);
  /* 拡大表示している画像の番号。閉じたら押した画像へ焦点を戻す。 */
  const [lightbox, setLightbox] = useState<number | null>(null);
  const imageButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const popTimer = useRef<number | null>(null);
  useEffect(() => () => { if (popTimer.current !== null) window.clearTimeout(popTimer.current); }, []);
  const articleRef = useRef<HTMLElement | null>(null);
  const [body, setBody] = useState(post.body);
  const [panel, setPanel] = useState<"none" | "quote" | "edit" | "report">("none");
  const [menuOpen, setMenuOpen] = useState(false);
  const [repostMenuOpen, setRepostMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  /*
   * 翻訳。本文の言語を既存の判定（shouldOfferTranslation）で見て、表示言語と
   * 違うときだけ札を出す。取るのは既存と同じ POST /api/translate。
   */
  const [translation, setTranslation] = useState<{ text: string; shown: boolean; loading: boolean } | null>(null);
  const offerTranslation = shouldOfferTranslation(body, (locale === "ja" ? "ja" : "en") as HubLocale);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const repostMenuRef = useRef<HTMLDivElement | null>(null);
  const requestIds = useRef(new Map<string, string>());

  useEffect(() => {
    if (!menuOpen && !repostMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (!repostMenuRef.current?.contains(event.target as Node)) setRepostMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); setRepostMenuOpen(false); }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, repostMenuOpen]);

  const fail = useCallback((caught: unknown, fallback: string) => {
    onError?.(caught instanceof Error && caught.message ? caught.message : fallback);
  }, [onError]);

  /* 同じ本文には同じ client_request_id。二重送信は同じ鍵で弾かれる。 */
  const requestId = (key: string) => {
    const existing = requestIds.current.get(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    requestIds.current.set(key, fresh);
    return fresh;
  };

  const update = (change: (previous: EngagementState) => EngagementState) => {
    view.current = change(view.current);
    setState(view.current);
  };

  /*
   * いいねと保存。押した瞬間に画面を変え（楽観的更新）、ボタンは止めない。
   * 通信中にもう一度押されたら、画面の値だけを動かし、いまの通信が終わってから
   * 最後の状態だけを送る。失敗したらサーバーの確定値へ戻して知らせる。
   */
  const flush = useCallback(async (kind: "reaction" | "bookmark") => {
    if (running.current[kind]) return;
    running.current[kind] = true;
    try {
      for (;;) {
        const want = kind === "reaction" ? view.current.liked : view.current.bookmarked;
        const have = kind === "reaction" ? confirmed.current.liked : confirmed.current.bookmarked;
        if (want === have) break;
        const response = await fetch(`/api/engagements/${kind}`, {
          method: want ? "PUT" : "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target_type: "social_post",
            target_id: post.id,
            ...(kind === "reaction" ? { kind: "like" } : {}),
          }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as {
          summary?: { likeCount: number; bookmarked: boolean; viewerReaction: string | null };
        };
        const summary = payload.summary;
        if (!summary) throw new Error();
        if (kind === "reaction") {
          confirmed.current = { ...confirmed.current, likeCount: summary.likeCount, liked: summary.viewerReaction === "like" };
          if (view.current.liked === confirmed.current.liked) update((previous) => ({ ...previous, likeCount: confirmed.current.likeCount }));
        } else {
          confirmed.current = { ...confirmed.current, bookmarked: summary.bookmarked };
          if (view.current.bookmarked === confirmed.current.bookmarked) update((previous) => ({ ...previous, bookmarked: confirmed.current.bookmarked }));
          onBookmarkChanged?.();
        }
        onError?.(null);
      }
    } catch {
      if (kind === "reaction") update((previous) => ({ ...previous, liked: confirmed.current.liked, likeCount: confirmed.current.likeCount }));
      else update((previous) => ({ ...previous, bookmarked: confirmed.current.bookmarked }));
      onError?.(ja
        ? "反映できませんでした。通信を確かめてもう一度お試しください。"
        : "That did not go through. Check your connection and try again.");
    } finally {
      running.current[kind] = false;
    }
  }, [post.id, ja, onError, onBookmarkChanged]);

  const toggle = (kind: "reaction" | "bookmark") => {
    if (kind === "reaction") {
      const next = !view.current.liked;
      update((previous) => ({ ...previous, liked: next, likeCount: Math.max(0, previous.likeCount + (next ? 1 : -1)) }));
      if (next) {
        setPop(true);
        if (popTimer.current !== null) window.clearTimeout(popTimer.current);
        popTimer.current = window.setTimeout(() => { popTimer.current = null; setPop(false); }, 320);
      }
    } else {
      update((previous) => ({ ...previous, bookmarked: !previous.bookmarked }));
    }
    void flush(kind);
  };

  /* リポスト。付いていれば取り消す。同じ形で、最後の状態だけを送る。 */
  const flushRepost = async () => {
    if (running.current.repost) return;
    running.current.repost = true;
    let failure: { caught: unknown; undo: boolean } | null = null;
    try {
      for (;;) {
        const want = view.current.reposted;
        const repostId = confirmed.current.repostId;
        if (want === Boolean(repostId)) break;
        if (!want && repostId) {
          try {
            await call(`/api/social/posts/${encodeURIComponent(repostId)}`, "DELETE");
          } catch (caught) { failure = { caught, undo: true }; break; }
          confirmed.current = { ...confirmed.current, repostId: null, repostCount: Math.max(0, confirmed.current.repostCount - 1) };
        } else {
          try {
            const payload = await call("/api/social/posts", "POST", {
              body: "",
              identity_mode: "account",
              repost_of_target_type: "social_post",
              repost_of_target_id: post.id,
              client_request_id: requestId(`repost:${post.id}`),
            }) as { post?: { id?: string } };
            const createdId = payload.post?.id;
            if (!createdId) throw new Error();
            requestIds.current.delete(`repost:${post.id}`);
            confirmed.current = { ...confirmed.current, repostId: createdId, repostCount: confirmed.current.repostCount + 1 };
          } catch (caught) { failure = { caught, undo: false }; break; }
        }
        onError?.(null);
      }
    } finally {
      running.current.repost = false;
    }
    if (failure) {
      update((previous) => ({ ...previous, reposted: Boolean(confirmed.current.repostId), repostCount: confirmed.current.repostCount }));
      fail(failure.caught, failure.undo
        ? (ja ? "リポストを取り消せませんでした。" : "Could not undo the repost.")
        : (ja ? "リポストできませんでした。" : "Could not repost."));
    }
  };

  const toggleRepost = () => {
    if (!viewerId) return;
    const next = !view.current.reposted;
    update((previous) => ({ ...previous, reposted: next, repostCount: Math.max(0, previous.repostCount + (next ? 1 : -1)) }));
    void flushRepost();
  };

  const submitQuote = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const payload = await call("/api/social/posts", "POST", {
        body: text,
        identity_mode: "account",
        quote_of_target_type: "social_post",
        quote_of_target_id: post.id,
        client_request_id: requestId(`quote:${post.id}:${text}`),
      }) as { post?: V2PostData };
      if (!payload.post?.id) throw new Error();
      requestIds.current.delete(`quote:${post.id}:${text}`);
      setDraft("");
      setPanel("none");
      setNotice(ja ? "引用して投稿しました。" : "Quoted.");
      /* 作成の応答には引用元の札が付かない。読み直すまで待たせず、手元の情報で付ける。 */
      if (payload.post) {
        onCreated?.({
          ...payload.post,
          referenced: payload.post.referenced ?? {
            label: ja ? "引用" : "Quoting",
            title: post.displayName,
            body: post.body,
            href: `/v2/posts/${post.id}`,
          },
        });
      }
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "引用できませんでした。" : "Could not quote.");
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const payload = await call(`/api/social/posts/${encodeURIComponent(post.id)}`, "PATCH", { body: text }) as { post?: { body?: string } };
      setBody(payload.post?.body ?? text);
      setPanel("none");
      setNotice(ja ? "編集しました。" : "Edited.");
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "編集できませんでした。" : "Could not edit.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!window.confirm(ja ? "この投稿を削除しますか。元に戻せません。" : "Delete this post? This cannot be undone.")) return;
    setBusy(true);
    try {
      await call(`/api/social/posts/${encodeURIComponent(post.id)}`, "DELETE");
      setRemoved(true);
      onRemoved?.(post.id);
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "削除できませんでした。" : "Could not delete.");
    } finally {
      setBusy(false);
    }
  };

  const safety = async (action: "mute" | "block") => {
    if (!post.authorProfileId || busy) return;
    const question = action === "block"
      ? (ja ? `@${post.handle ?? ""} をブロックしますか。相互にやり取りできなくなります。` : `Block @${post.handle ?? ""}?`)
      : (ja ? `@${post.handle ?? ""} をミュートしますか。` : `Mute @${post.handle ?? ""}?`);
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      await call("/api/profile/safety", "PATCH", { targetProfileId: post.authorProfileId, action, enabled: true });
      setNotice(action === "block" ? (ja ? "ブロックしました。" : "Blocked.") : (ja ? "ミュートしました。" : "Muted."));
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "反映できませんでした。" : "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await call(`/api/social/posts/${encodeURIComponent(post.id)}/report`, "POST", { reason: form.get("reason"), details: form.get("details") });
      setPanel("none");
      setNotice(ja ? "通報を受け付けました。" : "Report received.");
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "通報を送れませんでした。" : "Could not report.");
    } finally {
      setBusy(false);
    }
  };

  const translate = async () => {
    if (translation?.loading) return;
    if (translation?.text) {
      setTranslation({ ...translation, shown: !translation.shown });
      return;
    }
    setTranslation({ text: "", shown: false, loading: true });
    try {
      const payload = await call("/api/translate", "POST", { targetType: "social_post", targetId: post.id, targetLocale: locale === "ja" ? "ja" : "en" }) as { translation?: string };
      if (!payload.translation) throw new Error();
      setTranslation({ text: payload.translation, shown: true, loading: false });
      onError?.(null);
    } catch (caught) {
      setTranslation(null);
      fail(caught, ja ? "翻訳できませんでした。" : "Could not translate.");
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/v2/posts/${post.id}`;
    try {
      if (navigator.share) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        setNotice(ja ? "リンクを複製しました。" : "Link copied.");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      onError?.(ja ? "共有できませんでした。" : "Could not share.");
    }
  };

  const openPanel = (next: "quote" | "edit" | "report") => {
    setMenuOpen(false);
    setRepostMenuOpen(false);
    setNotice(null);
    setDraft(next === "edit" ? body : "");
    setPanel((current) => (current === next ? "none" : next));
  };

  const own = Boolean(viewerId) && post.authorProfileId === viewerId;
  const detailHref = withSocialStreamReturn(`/v2/posts/${post.id}`, returnTo);
  const avatarSize = emphasized ? 48 : 40;

  /*
   * 行のどこを押しても詳細へ。リンク・押し手・入力・文字の選択中は除く。
   * 時刻のリンクを押すだけなので、遷移は Link に任せ、ここでは何も組み立てない。
   */
  const openDetail = (event: ReactMouseEvent<HTMLElement>) => {
    if (emphasized || event.defaultPrevented || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("a,button,input,textarea,select,label,summary,form,.v2-menu,.v2-post__panel")) return;
    if (typeof window.getSelection === "function" && window.getSelection()?.toString()) return;
    articleRef.current?.querySelector<HTMLAnchorElement>("a.v2-post__time")?.click();
  };

  if (removed) {
    return (
      <article className="v2-post v2-post--removed">
        <span className="v2-post__avatar ui-avatar ui-avatar--40" aria-hidden="true" />
        <p className="v2-note">{ja ? "削除しました。" : "Deleted."}</p>
      </article>
    );
  }

  if (post.accessGate) {
    /* 詳細ページ（emphasized）は手順・再確認・購入欄のある完全なカード。一覧は小さな表示だけ。 */
    if (!emphasized) return <V2GatedPostCompact post={post} gate={post.accessGate.gate} detailHref={detailHref} locale={locale} />;
    return (
      <article className="v2-post v2-post--gated">
        <V2GatedRefreshCard
          gate={post.accessGate.gate}
          status={post.accessGate.status}
          title={post.displayName}
          targetType="post"
          targetId={post.id}
        />
      </article>
    );
  }

  const imageCount = Math.min(post.images?.length ?? 0, 4);

  return (
    <article
      ref={articleRef}
      className={emphasized ? "v2-post v2-post--emphasized" : "v2-post v2-post--row"}
      data-post-id={post.id}
      onClick={openDetail}
    >
      <Avatar className="v2-post__avatar" name={post.displayName} src={post.avatarUrl} size={avatarSize} />

      <div className="v2-post__body">
        <header className="v2-post__header">
          {post.handle ? (
            <Link className="v2-post__author" href={`/v2/profile/${post.handle}`}>
              <span className="v2-post__name">{post.displayName}</span>
              <span className="v2-post__handle">@{post.handle}</span>
            </Link>
          ) : (
            <span className="v2-post__author"><span className="v2-post__name">{post.displayName}</span></span>
          )}
          {post.imported ? (
            <span
              className="v2-post__handle"
              title={locale === "en" ? `Originally posted ${post.imported.originalPublishedAt}` : `元の投稿日時: ${post.imported.originalPublishedAt}`}
            >
              {locale === "en" ? "Before the move" : "移転前の投稿"}{post.imported.verified ? "" : locale === "en" ? " (unverified)" : "（出自未確認）"}
            </span>
          ) : null}
          <Link className="v2-post__time" href={detailHref}>
            <V2RelativeTime value={post.createdAt} locale={locale} />
          </Link>
          {/* 共有以外の管理操作・おすすめの調整は ••• に置く。 */}
          <div className="v2-post__more v2-post__more--end" ref={menuRef}>
            <PostAction icon="more" label={ja ? "その他" : "More"} expanded={menuOpen} onClick={() => { setRepostMenuOpen(false); setMenuOpen((current) => !current); }} />
            {menuOpen ? (
              <div className="v2-menu" role="menu">
                {discovery ? (
                  <>
                    <p className="v2-menu__note">{discovery.reason}</p>
                    <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setMenuOpen(false); discovery.dismiss(); }}>{ja ? "興味なし" : "Not interested"}</button>
                    {discovery.restoreAuthor
                      ? <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setMenuOpen(false); discovery.restoreAuthor?.(); }}>{ja ? "この作者の順位を元に戻す" : "Restore this author's priority"}</button>
                      : discovery.reduceAuthor
                        ? <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setMenuOpen(false); discovery.reduceAuthor?.(); }}>{ja ? "この作者を減らす" : "Show less from this author"}</button>
                        : null}
                    <hr className="v2-menu__rule" />
                  </>
                ) : null}
                <button type="button" role="menuitem" className="v2-menu__item" onClick={() => {
                  setMenuOpen(false);
                  const context: HubAiContext = { source: "feed", targetId: post.id, title: post.displayName, content: body, href: `/v2/posts/${post.id}` };
                  window.dispatchEvent(new CustomEvent(HUB_AI_CONTEXT_EVENT, { detail: context }));
                }}>{ja ? "AIに相談" : "Ask AI"}</button>
                {videoOwnerHide ? (
                  <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setMenuOpen(false); void videoOwnerHide.onToggle(post.id, !videoOwnerHide.hidden); }}>
                    {videoOwnerHide.hidden ? (ja ? "コメントを再表示" : "Show comment") : (ja ? "コメントを非表示" : "Hide comment")}
                  </button>
                ) : null}
                {!viewerId ? null : own ? (
                  <>
                    <button type="button" role="menuitem" className="v2-menu__item" onClick={() => openPanel("edit")}>{ja ? "編集" : "Edit"}</button>
                    <button type="button" role="menuitem" className="v2-menu__item v2-menu__item--danger" onClick={() => { setMenuOpen(false); void remove(); }}>{ja ? "削除" : "Delete"}</button>
                  </>
                ) : (
                  <>
                    <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setMenuOpen(false); void safety("mute"); }}>{ja ? "ミュート" : "Mute"}</button>
                    <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setMenuOpen(false); void safety("block"); }}>{ja ? "ブロック" : "Block"}</button>
                    <button type="button" role="menuitem" className="v2-menu__item v2-menu__item--danger" onClick={() => openPanel("report")}>{ja ? "通報" : "Report"}</button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </header>

        {post.replyToVideo ? (
          <p className="v2-post__reply-to">
            {ja ? "動画への返信 " : "Reply to video "}
            <Link href={`/v2/videos/${encodeURIComponent(post.replyToVideo.id)}`}>{post.replyToVideo.title || (ja ? "動画" : "video")}</Link>
            {post.replyToVideo.seconds ? ` ${Math.floor(post.replyToVideo.seconds / 60)}:${String(post.replyToVideo.seconds % 60).padStart(2, "0")}` : ""}
          </p>
        ) : null}

        {post.replyToPostId && post.replyToHandle ? (
          <p className="v2-post__reply-to">
            {ja ? "返信先 " : "Replying to "}
            <Link href={`/v2/profile/${encodeURIComponent(post.replyToHandle)}`}>@{post.replyToHandle}</Link>
          </p>
        ) : null}

        {panel === "edit" ? (
          <div className="v2-post__panel">
            <textarea
              className="v2-reply__input"
              value={draft}
              maxLength={HUB_SOCIAL_POST_MAX_CHARACTERS}
              disabled={busy}
              aria-label={ja ? "編集する本文" : "Edited body"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submitEdit(); }}
            />
            <div className="v2-reply__footer">
              <span className="v2-reply__remaining">{HUB_SOCIAL_POST_MAX_CHARACTERS - draft.length}</span>
              <V2Button variant="text" label={ja ? "やめる" : "Cancel"} onClick={() => setPanel("none")} />
              <V2Button variant="primary" label={busy ? (ja ? "保存しています…" : "Saving…") : (ja ? "保存する" : "Save")} disabled={!draft.trim() || busy} onClick={() => void submitEdit()} />
            </div>
          </div>
        ) : (
          <p className={emphasized ? "v2-post__text v2-post__text--emphasized" : "v2-post__text"}><V2PostBody body={body} /></p>
        )}

        {offerTranslation ? (
          <button
            type="button"
            className="v2-post__translate"
            aria-pressed={Boolean(translation?.shown)}
            disabled={translation?.loading}
            onClick={() => void translate()}
          >
            {translation?.loading ? (ja ? "翻訳しています…" : "Translating…") : translation?.shown ? (ja ? "原文" : "Original") : (ja ? "翻訳" : "Translate")}
          </button>
        ) : null}

        {panel !== "edit" && !post.images?.length ? <V2LinkCard body={body} japanese={ja} /> : null}

        {imageCount ? (
          <div className={`v2-post__images v2-post__images--${imageCount}`}>
            {post.images!.slice(0, 4).map((image, index) => {
              const sources = imageSources(image);
              return (
                <button
                  key={image.id}
                  ref={(node) => { imageButtons.current[index] = node; }}
                  type="button"
                  className="v2-post__image"
                  aria-label={image.altText ? (ja ? `画像を拡大：${image.altText}` : `Enlarge image: ${image.altText}`) : (ja ? `画像を拡大（${index + 1}/${imageCount}）` : `Enlarge image (${index + 1}/${imageCount})`)}
                  onClick={(event) => { event.stopPropagation(); setLightbox(index); }}
                >
                  <img
                    src={sources.src}
                    srcSet={sources.srcSet}
                    sizes={sources.srcSet ? (imageCount === 1 ? "(min-width: 640px) 560px, 100vw" : "(min-width: 640px) 280px, 50vw") : undefined}
                    alt={image.altText}
                    width={image.width || undefined}
                    height={image.height || undefined}
                    loading="lazy"
                    decoding="async"
                    style={imageCount === 1 && image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
                  />
                </button>
              );
            })}
          </div>
        ) : null}
        {lightbox !== null && post.images?.length ? (
          <V2ImageLightbox
            images={post.images.slice(0, 4).map((image) => ({ id: image.id, url: image.url, fullUrl: fullImageUrl(image), altText: image.altText }))}
            index={lightbox}
            japanese={ja}
            onClose={() => { const opener = imageButtons.current[lightbox]; setLightbox(null); opener?.focus({ preventScroll: true }); }}
          />
        ) : null}

        {post.referenced ? (
          /* 引用元・リポスト元の札。本文と画像の後ろに置く。題だけでなく本文の頭も見せる。 */
          <Link className="v2-post__referenced" href={withSocialStreamReturn(post.referenced.href, returnTo)}>
            <span className="v2-post__referenced-label">
              {referencedKindLabel(post.referenced.label, ja)}
              {post.referenced.contextLabel ? ` · ${post.referenced.contextLabel}` : ""}
            </span>
            <span className="v2-post__referenced-title">{post.referenced.title}</span>
            {post.referenced.body ? <span className="v2-post__referenced-body">{post.referenced.body}</span> : null}
          </Link>
        ) : null}

        {visibleTags(post.tags).length ? (
          <V2TagChipRow tags={visibleTags(post.tags)} kind="posts" max={emphasized ? 8 : 3} size="sm" label={ja ? "タグ" : "Tags"} />
        ) : null}

        {emphasized ? <V2PostStamp value={post.createdAt} locale={locale} /> : null}
        {emphasized && (state.repostCount > 0 || state.likeCount > 0) ? (
          <p className="v2-post__counts">
            {state.repostCount > 0 ? <span><strong>{state.repostCount}</strong> {ja ? "リポスト" : "Reposts"}</span> : null}
            {state.likeCount > 0 ? <span><strong>{state.likeCount}</strong> {ja ? "いいね" : "Likes"}</span> : null}
          </p>
        ) : null}

        {/* 返信・リポスト・いいね・保存・共有。押しても止めず、画面を先に変える。 */}
        <div className="v2-post__actions">
          <PostAction icon="reply" action="reply" label={ja ? "返信" : "Reply"} count={post.replyCount || undefined} href={detailHref} />
          <div className="v2-post__more" ref={repostMenuRef}>
            <PostAction icon="repeat" action="repost" label={ja ? "リポストの操作" : "Repost options"} count={state.repostCount || undefined} pressed={state.reposted} expanded={repostMenuOpen} disabled={!viewerId} onClick={() => { setMenuOpen(false); setRepostMenuOpen((open) => !open); }} />
            {repostMenuOpen ? (
              <div className="v2-menu" role="menu">
                <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setRepostMenuOpen(false); toggleRepost(); }}>{state.reposted ? (ja ? "リポストを取り消す" : "Undo repost") : (ja ? "リポスト" : "Repost")}</button>
                <button type="button" role="menuitem" className="v2-menu__item" onClick={() => openPanel("quote")}>{ja ? "引用" : "Quote"}</button>
              </div>
            ) : null}
          </div>
          <PostAction icon="heart" action="like" tone="like" pop={pop} label={ja ? "いいね" : "Like"} count={state.likeCount || undefined} pressed={state.liked} disabled={!viewerId} onClick={() => toggle("reaction")} />
          <PostAction icon="bookmark" action="bookmark" label={state.bookmarked ? (ja ? "保存済み" : "Saved") : (ja ? "保存" : "Save")} pressed={state.bookmarked} disabled={!viewerId} onClick={() => toggle("bookmark")} />
          <PostAction icon="share" action="share" label={ja ? "共有" : "Share"} onClick={() => void share()} />
        </div>

        {translation?.shown ? <p className="v2-post__text v2-post__translation" lang={locale === "ja" ? "ja" : "en"}>{translation.text}</p> : null}

        {notice ? <p className="v2-note v2-post__notice" role="status">{notice}</p> : null}

        {panel === "quote" ? (
          <div className="v2-post__panel">
            <textarea
              className="v2-reply__input"
              value={draft}
              maxLength={HUB_SOCIAL_POST_MAX_CHARACTERS}
              disabled={busy}
              placeholder={ja ? "引用に添える本文" : "Say something about this"}
              aria-label={ja ? "引用の本文" : "Quote body"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submitQuote(); }}
            />
            <div className="v2-reply__footer">
              <span className="v2-reply__remaining">{HUB_SOCIAL_POST_MAX_CHARACTERS - draft.length}</span>
              <V2Button variant="text" label={ja ? "やめる" : "Cancel"} onClick={() => setPanel("none")} />
              <V2Button variant="primary" label={busy ? (ja ? "送っています…" : "Sending…") : (ja ? "引用して投稿" : "Quote")} disabled={!draft.trim() || busy} onClick={() => void submitQuote()} />
            </div>
          </div>
        ) : null}

        {panel === "report" ? (
          <form className="v2-post__panel" onSubmit={submitReport}>
            <label className="v2-filter__row">
              <span>{ja ? "理由" : "Reason"}</span>
              <select name="reason" defaultValue="spam">
                {REPORT_REASONS.map((reason) => <option key={reason.id} value={reason.id}>{ja ? reason.ja : reason.en}</option>)}
              </select>
            </label>
            <textarea className="v2-reply__input" name="details" rows={3} maxLength={500} placeholder={ja ? "詳しく（任意）" : "Details (optional)"} />
            <div className="v2-reply__footer">
              <V2Button variant="text" label={ja ? "やめる" : "Cancel"} onClick={() => setPanel("none")} />
              <V2Button variant="primary" type="submit" label={ja ? "通報する" : "Report"} disabled={busy} />
            </div>
          </form>
        ) : null}
      </div>
    </article>
  );
}

/*
 * 操作行の1つ。記号20px・件数13px。押せる領域は机上36px・携帯44px（CSS）。
 * 押下中も無効にしない。aria-pressed は見た目だけを変える。
 */
function PostAction({ icon, label, count, pressed, expanded, disabled, onClick, href, tone, pop, action }: {
  icon: V2IconName;
  label: string;
  count?: number | string;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  tone?: "like";
  pop?: boolean;
  action?: "reply" | "repost" | "like" | "bookmark" | "share";
}) {
  const className = ["v2-act", `v2-act--${icon}`, tone ? `v2-act--${tone}` : "", pop ? "v2-act--pop" : ""].filter(Boolean).join(" ");
  const inner = (
    <>
      <span className="v2-act__glyph"><V2Icon name={icon} /></span>
      <span className="v2-sr">{label}</span>
      {count !== undefined && count !== 0 && count !== "" ? <span className="v2-act__count">{count}</span> : null}
    </>
  );
  if (href !== undefined) {
    return <Link className={className} href={href} title={label} data-post-action={action}>{inner}</Link>;
  }
  return (
    <button type="button" className={className} title={label} aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick} data-post-action={action}>
      {inner}
    </button>
  );
}

/*
 * 詳細の日時の行。「午後3:12 · 2026年10月12日」。端末の時刻で整えるので、
 * サーバーの描画とずれないよう、描いた後で差し替える（それまでは日付だけ）。
 */
function V2PostStamp({ value, locale }: { value: string; locale: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return;
    const tag = locale === "ja" ? "ja-JP" : "en-US";
    const time = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit" }).format(date);
    const day = new Intl.DateTimeFormat(tag, { year: "numeric", month: "long", day: "numeric" }).format(date);
    setText(`${time} · ${day}`);
  }, [value, locale]);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return <p className="v2-post__stamp"><time dateTime={date.toISOString()}>{text || date.toISOString().slice(0, 10)}</time></p>;
}
