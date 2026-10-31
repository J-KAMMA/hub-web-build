"use client";

import { useEffect, useState } from "react";

import { MediaFrame } from "@/components/v2/ui";
import { V2ActionCard } from "@/components/v2/v2-action-card";
import { extractFirstEmbeddedMedia, extractFirstExternalImage, extractFirstExternalLink } from "@/lib/external-link";
import { isAffiliateUrl } from "@/lib/affiliate-link";
import type { LinkPreview } from "@/lib/link-preview";

/*
 * 本文の最初の外部リンクを札にする。既存の external-link-card.tsx から
 * 「下見を取って札を出す」だけを抜いた。判定（どの URL を札にするか、
 * 画像そのもの、動画の埋め込み）は既存の lib/external-link.ts を呼ぶ。
 *
 * 既存との違い: 動画も埋め込まず、配信元へ渡す札にする（右列で本文を見ながら
 * 動画が鳴るのは困る）。画像そのものの URL は画像として出す。
 * 下見が取れなければ何も出さない（本文の URL は文字のまま残る）。
 *
 * 下見に action（公開投影）が付いていれば、素の札ではなく **Action Card** を出す
 * （2026-09-03。構想では投稿から所有サービスの行動へ繋ぐ層が Hub の中心で、
 * v2 にはそれが抜けていた。docs/HUB_SYSTEM_MAP.md 第2章）。
 */

function isPreview(value: unknown): value is LinkPreview {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.url === "string" && typeof record.title === "string" && typeof record.siteName === "string";
}

export function V2LinkCard({ body, japanese }: { body: string; japanese: boolean }) {
  const link = extractFirstExternalLink(body);
  const media = extractFirstEmbeddedMedia(body);
  const image = extractFirstExternalImage(body);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  /* 縮小版が読めない（配信元が拒む）ことがある。空の枠を残さず、文字だけにする。 */
  const [imageBroken, setImageBroken] = useState(false);

  useEffect(() => {
    if (!link || image) return;
    const controller = new AbortController();
    fetch(`/api/link-preview?url=${encodeURIComponent(link.url)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => { if (isPreview(value)) setPreview(value); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [link?.url, image]);

  if (!link) return null;

  if (image) {
    return (
      <a className="v2-link v2-link--image" href={image.url} target="_blank" rel="noopener noreferrer nofollow ugc">
        <MediaFrame src={image.imageUrl} ratio="16/9" width={1280} height={720} radius="md" referrerPolicy="no-referrer" />
        <span className="v2-link__site">{image.hostname}</span>
      </a>
    );
  }

  /* 所有サービスが出した行動の投影があれば、素の札ではなくこれを出す。値段も状態も投影の写し。 */
  if (preview?.action) {
    return (
      <div className="v2-link v2-link--hubaction">
        <V2ActionCard action={preview.action} japanese={japanese} />
        {isAffiliateUrl(link.url) ? (
          <p className="v2-hubaction__affiliate">
            {japanese ? "投稿者のアフィリエイトリンクです。購入により投稿者へ報酬が発生する場合があります。" : "The poster earns a commission on purchases."}
          </p>
        ) : null}
      </div>
    );
  }

  if (!preview && !media) return null;
  /*
   * 下見が取れない（YouTube は 502 を返すことがある）ときも、配信元の名前を
   * 2行続けて出さない。題の代わりに「YouTube の動画」、配信元の行はホスト名。
   */
  const title = preview?.title || (media
    ? (japanese ? `${media.providerLabel}の${media.mediaKind === "video" ? "動画" : "コンテンツ"}` : `${media.providerLabel} ${media.mediaKind === "video" ? "video" : "content"}`)
    : link.hostname);
  const thumbnail = media?.thumbnailUrl ?? preview?.imageUrl ?? null;
  const showImage = Boolean(thumbnail) && !imageBroken;

  return (
    <a className="v2-link" href={link.url} target="_blank" rel="noopener noreferrer nofollow ugc">
      {showImage ? (
        <MediaFrame
          src={thumbnail}
          ratio="16/9"
          width={640}
          height={360}
          radius="none"
          className="v2-link__frame"
          referrerPolicy="no-referrer"
          onError={() => setImageBroken(true)}
        />
      ) : null}
      <span className="v2-link__text">
        <span className="v2-link__site">{preview?.siteName || link.hostname}</span>
        <span className="v2-link__title">{title}</span>
        {preview?.description && !showImage ? <span className="v2-link__description">{preview.description}</span> : null}
      </span>
    </a>
  );
}
