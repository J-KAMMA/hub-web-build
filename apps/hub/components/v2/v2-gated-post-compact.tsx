import Link from "next/link";

import type { PublicAccessGate } from "@/lib/access-gates/types";
import { Avatar } from "@/components/v2/ui/avatar";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";

import "./v2-access-gates.css";

/*
 * 閲覧条件つきの投稿の、一覧用の小さな表示（X のサブスク限定ポストに近い形）。
 * 本文・画像・手順・購入欄は出さない。条件は作成者が公開している説明を1行にするだけ。
 * 手順・再確認・GohoToken の購入は、詳細ページの V2GatedLockedCard にある。
 */

const MAX_LINE = 80;

export function gatedPostLine(gate: PublicAccessGate, ja: boolean): string {
  const description = gate.description.trim().replace(/\s+/g, " ");
  if (!description) return ja ? "条件を満たす人向けの投稿です" : "A post for people who meet the condition";
  const clipped = description.length > MAX_LINE ? `${description.slice(0, MAX_LINE)}…` : description;
  if (!ja) return clipped;
  return /人$/.test(clipped) ? `${clipped}向けの投稿です` : clipped;
}

export function V2GatedPostCompact({ post, gate, detailHref, locale }: {
  post: { id: string; displayName: string; handle?: string | null; avatarUrl?: string | null; createdAt: string };
  gate: PublicAccessGate;
  detailHref: string;
  locale: string;
}) {
  const ja = locale === "ja";
  return (
    <article className="v2-post v2-post--row v2-post--gated" data-post-id={post.id}>
      <Avatar className="v2-post__avatar" name={post.displayName} src={post.avatarUrl ?? undefined} size={40} />
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
          <Link className="v2-post__time" href={detailHref}>
            <V2RelativeTime value={post.createdAt} locale={locale} />
          </Link>
          <span className="v2-post__lock">{ja ? "鍵つき" : "Locked"}</span>
        </header>
        <p className="v2-post__gate-line">{gatedPostLine(gate, ja)}</p>
        <p className="v2-post__gate-actions">
          <Link className="v2-gate__button" href={detailHref}>{ja ? "開く" : "Open"}</Link>
        </p>
      </div>
    </article>
  );
}
