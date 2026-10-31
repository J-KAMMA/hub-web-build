import React from "react";
import type { HubAdPlacement } from "@/lib/advertising";
import type { ServedAd } from "@/components/first-party-ad-slot";

type StaticDemoPlacement = HubAdPlacement | "threads" | "videos" | "music";

const DEMO_ADS: Record<
  StaticDemoPlacement,
  { headline: string; description: string; callToAction: string; href: string }
> = {
  home: {
    headline: "Hub スポンサー枠",
    description: "コミュニティに自然になじむ広告表示のデモです。",
    callToAction: "Hubについて見る",
    href: "/about",
  },
  "hubpedia-index": {
    headline: "知識を支えるスポンサー枠",
    description: "Hubpediaの閲覧を妨げない掲載イメージです。",
    callToAction: "Hubpediaを見る",
    href: "/hubpedia",
  },
  "hubpedia-article": {
    headline: "記事スポンサー枠",
    description: "記事本文と明確に区別した広告表示のデモです。",
    callToAction: "広告について見る",
    href: "/about",
  },
  "hubpedia-article-bottom": {
    headline: "読了後スポンサー枠",
    description: "記事を読み終えた位置に表示する広告デモです。",
    callToAction: "Hubをもっと見る",
    href: "/",
  },
  shopping: {
    headline: "マーケット注目枠",
    description: "商品一覧に掲載するスポンサー広告のデモです。",
    callToAction: "マーケットを見る",
    href: "/market",
  },
  threads: {
    headline: "スレッドスポンサー枠",
    description: "会話の流れを妨げない広告表示のデモです。",
    callToAction: "Hubについて見る",
    href: "/about",
  },
  videos: {
    headline: "動画スポンサー枠",
    description: "再生を中断しない発見フィード広告のデモです。",
    callToAction: "動画を探す",
    href: "/videos",
  },
  music: {
    headline: "音楽スポンサー枠",
    description: "再生や曲選びを妨げないサイド広告のデモです。",
    callToAction: "音楽を探す",
    href: "/music",
  },
};

export function staticDemoServedAd(placement: StaticDemoPlacement): ServedAd {
  const ad = DEMO_ADS[placement];
  return {
    label: "広告・デモ",
    advertiserDisplayName: "Hub Ads デモ",
    headline: ad.headline,
    description: ad.description,
    altText: "",
    callToAction: ad.callToAction,
    clickUrl: ad.href,
    aboutUrl: "/about",
  };
}

export function StaticDemoAd({
  placement,
}: {
  placement: StaticDemoPlacement;
}) {
  const ad = DEMO_ADS[placement];
  return (
    <aside
      className="advertising advertising--demo"
      aria-label="広告"
      data-ad-placement={placement}
      data-ad-mode="static-demo"
    >
      <span className="advertising__label">広告・デモ</span>
      <a className="advertising__card" href={ad.href} rel="sponsored nofollow">
        <strong>{ad.headline}</strong>
        <span>{ad.description}</span>
        <small>{ad.callToAction} →</small>
      </a>
      <small className="advertising__disclosure">
        提供: Hub Ads デモ ・ API配信と計測は未使用
      </small>
    </aside>
  );
}
