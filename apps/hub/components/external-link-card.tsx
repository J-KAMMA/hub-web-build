"use client";

import React, { useEffect, useState } from "react";

import { extractFirstEmbeddedMedia, extractFirstExternalImage, extractFirstExternalLink, extractFirstImageHostingPost } from "@/lib/external-link";
import type { LinkPreview } from "@/lib/link-preview";
import { isAffiliateUrl } from "@/lib/affiliate-link";
import { isHubActionProjection } from "@/lib/action-layer";
import { HubActionCard } from "@/components/hub-action-card";

function isLinkPreview(value: unknown): value is LinkPreview {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "url") === "string" &&
    typeof Reflect.get(value, "siteName") === "string" &&
    typeof Reflect.get(value, "title") === "string" &&
    typeof Reflect.get(value, "description") === "string" &&
    (typeof Reflect.get(value, "imageUrl") === "string" || Reflect.get(value, "imageUrl") === null) &&
    (Reflect.get(value, "kind") === undefined || Reflect.get(value, "kind") === "video") &&
    (Reflect.get(value, "action") === undefined || isHubActionProjection(Reflect.get(value, "action")));
}

export function ExternalLinkCard({ body }: { body: string }) {
  const link = extractFirstExternalLink(body);
  const media = extractFirstEmbeddedMedia(body);
  const directImage = extractFirstExternalImage(body);
  const imageHostingPost = extractFirstImageHostingPost(body);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  useEffect(() => {
    if (!link || directImage) return;
    const controller = new AbortController();
    void fetch(`/api/link-preview?url=${encodeURIComponent(link.url)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value: unknown) => {
        if (isLinkPreview(value)) setPreview(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [link?.url, directImage]);

  if (!link) return null;
  const affiliateLink = isAffiliateUrl(link.url);
  const externalRel = affiliateLink
    ? "sponsored nofollow ugc noopener noreferrer"
    : "noopener noreferrer nofollow ugc";

  if (media) {
    return (
      <section className="external-media-card external-media-card--preview" data-provider={media.provider} data-media-kind={media.mediaKind}>
        <a className="external-media-card__preview" href={media.url} target="_blank" rel="noopener noreferrer nofollow ugc">
          {(media.thumbnailUrl ?? preview?.imageUrl) ? <img src={media.thumbnailUrl ?? preview?.imageUrl ?? ""} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="external-media-card__placeholder" aria-hidden="true">{media.providerLabel}</span>}
          <span><small>{media.providerLabel}</small><strong>{preview?.title || `${media.providerLabel}のコンテンツ`}</strong><small>配信元サイトで開く</small></span>
        </a>
        <a className="external-media-card__source" href={media.url} target="_blank" rel="noopener noreferrer nofollow ugc">
          {media.providerLabel}で開く<span aria-hidden="true">→</span>
        </a>
      </section>
    );
  }

  if (directImage) {
    return <figure className="external-image-card">
      <a href={directImage.url} target="_blank" rel="noopener noreferrer nofollow ugc">
        <img src={directImage.imageUrl} alt="リンク先の画像" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      </a>
      <figcaption><span>{directImage.hostname}</span><a href={directImage.url} target="_blank" rel="noopener noreferrer nofollow ugc">画像を元のサイトで見る <span aria-hidden="true">↗</span></a></figcaption>
    </figure>;
  }

  if (imageHostingPost) {
    return <figure className="external-image-site-card" data-provider={imageHostingPost.provider}>
      <a className="external-image-site-card__media" href={imageHostingPost.url} target="_blank" rel="noopener noreferrer nofollow ugc">
        {preview?.imageUrl ? <img src={preview.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : (
          <span className="external-image-site-card__placeholder" aria-hidden="true">Imgur</span>
        )}
      </a>
      <figcaption>
        <span className="external-image-site-card__copy">
          <small>{imageHostingPost.providerLabel}</small>
          {preview?.title ? <strong>{preview.title}</strong> : null}
          {preview?.description ? <span>{preview.description}</span> : null}
        </span>
        <a href={imageHostingPost.url} target="_blank" rel="noopener noreferrer nofollow ugc">Imgurで見る <span aria-hidden="true">→</span></a>
      </figcaption>
    </figure>;
  }

  const cardHref = link.url;
  if (preview?.action) {
    return <div className="external-link-card-shell">
      <HubActionCard action={preview.action} />
      {affiliateLink ? <aside className="external-link-card__affiliate" aria-label="アフィリエイトリンクの表示">
        <span>投稿者のアフィリエイトリンクです。購入により投稿者へ報酬が発生する場合があります。</span>
        {preview.action.href ? <a href={link.url} target="_blank" rel={externalRel}>投稿者の紹介リンクで販売店を見る <span aria-hidden="true">↗</span></a> : null}
      </aside> : null}
    </div>;
  }
  const card = preview ? (
      <a
        className="external-link-card external-link-card--rich"
        href={cardHref}
        target="_blank"
        rel={externalRel}
      >
        {preview.imageUrl ? (
          <img
            className="external-link-card__image"
            src={preview.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="external-link-card__rich-copy">
          <small>{preview.siteName}</small>
          <strong>{preview.title}</strong>
          {preview.description ? <span>{preview.description}</span> : null}
          <small>{link.hostname}</small>
        </span>
      </a>
    ) : (
    <a className="external-link-card" href={link.url} target="_blank" rel={externalRel}>
      <span className="external-link-card__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3 4.5 6 4.5 9S15 18 12 21M12 3c-3 3-4.5 6-4.5 9S9 18 12 21" />
        </svg>
      </span>
      <span className="external-link-card__copy">
        <strong>{link.hostname}</strong>
        <small>{link.displayUrl}</small>
      </span>
      <span className="external-link-card__open" aria-hidden="true">-&gt;</span>
    </a>
  );

  return <div className="external-link-card-shell">
    {card}
    {affiliateLink ? <aside className="external-link-card__affiliate" aria-label="アフィリエイトリンクの表示">
      <span>投稿者のアフィリエイトリンクです。購入により投稿者へ報酬が発生する場合があります。</span>
    </aside> : null}
  </div>;
}
