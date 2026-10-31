import Link from "next/link";

import { V2GatedPostCompact } from "@/components/v2/v2-gated-post-compact";
import { V2GateBadge } from "@/components/v2/v2-gate-badge";
import type { PublicAccessGate } from "@/lib/access-gates/types";

/* プロフィールの「鍵つきの作品」: 見出しの入口と、鍵つき投稿の並び。本文は持たない（サーバーで外した投稿だけを受ける）。 */

export function V2ProfileGatedButton({ handle, japanese }: { handle: string; japanese: boolean }) {
  return (
    <Link className="v2-button v2-button--text v2-profile__gated-link" href={`/v2/profile/${encodeURIComponent(handle)}?tab=gated`}>
      {japanese ? "鍵つきの作品" : "Locked works"}
    </Link>
  );
}

type GatedPostRow = { id: string; displayName: string; handle?: string | null; avatarUrl?: string | null; createdAt: string; replyToPostId?: string | null; accessGate?: { gate: PublicAccessGate } };

export function V2ProfileGatedPosts({ posts, locale }: { posts: readonly GatedPostRow[]; locale: string }) {
  const gated = posts.filter((post) => post.accessGate && !post.replyToPostId);
  if (!gated.length) return null;
  return (
    <section className="v2-profile-series">
      {gated.map((post) => (
        <V2GatedPostCompact key={post.id} post={post} gate={post.accessGate!.gate} detailHref={`/v2/posts/${post.id}`} locale={locale} />
      ))}
    </section>
  );
}

export type V2ProfileGatedWork =
  | { type: "post"; id: string; post: GatedPostRow; gate: PublicAccessGate }
  | { type: "article" | "video"; id: string; href: string; label: string; gate: PublicAccessGate };

/* 鍵つきの作品を新しい順に1本の並びで出す。投稿はコンパクトな札、記事と動画は題名の行。本文は渡さない。 */
export function V2ProfileGatedWorks({ items, locale }: { items: readonly V2ProfileGatedWork[]; locale: string }) {
  if (!items.length) return null;
  const japanese = locale === "ja";
  return (
    <section className="v2-profile-series">
      {items.map((item) => item.type === "post" ? (
        <V2GatedPostCompact key={`post:${item.id}`} post={item.post} gate={item.gate} detailHref={`/v2/posts/${item.id}`} locale={locale} />
      ) : (
        <Link key={`${item.type}:${item.id}`} className="v2-nav__item" href={item.href}>
          <span className="v2-nav__label">{item.label}</span>
          <V2GateBadge gate={item.gate} japanese={japanese} />
          <span className="v2-nav__count">{item.type === "article" ? (japanese ? "記事" : "Article") : (japanese ? "動画" : "Video")}</span>
        </Link>
      ))}
    </section>
  );
}
