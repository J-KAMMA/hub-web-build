"use client";

import React, { useEffect, useMemo, useState } from "react";
import { HUB_INTEREST_PROFILE_CHANGED_EVENT, readHubInterestProfile, scoreHubInterestText, topHubInterests } from "@/lib/hub-interest-profile";

export interface CrossRecommendationCandidate {
  id: string;
  kind: "post" | "video" | "music" | "product";
  title: string;
  description: string;
  href: string;
  topics: string[];
  featured?: boolean;
}

const STORAGE_KEYS = {
  posts: "hub.post_history",
  videos: "hub.video_history",
} as const;

function readIds(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function label(kind: CrossRecommendationCandidate["kind"]): string {
  return { post: "ポスト", video: "動画", music: "音楽", product: "マーケット" }[kind];
}

export function CrossRecommendations({ candidates }: { candidates: CrossRecommendationCandidate[] }) {
  const [signals, setSignals] = useState<{
    interests: string[];
    seen: Record<CrossRecommendationCandidate["kind"], string[]>;
  } | null>(null);

  useEffect(() => {
    const sync = () => setSignals({
      interests: topHubInterests(readHubInterestProfile()),
      seen: {
        post: readIds(STORAGE_KEYS.posts),
        video: readIds(STORAGE_KEYS.videos),
        music: [],
        product: [],
      },
    });
    sync();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
  }, []);

  const recommendations = useMemo(() => {
    if (!signals) return [];
    const kinds: CrossRecommendationCandidate["kind"][] = ["post", "video", "music", "product"];
    return kinds.flatMap((kind) => {
      const seen = new Set(signals.seen[kind]);
      const ranked = candidates.filter((item) => item.kind === kind).map((item, index) => {
        const text = [item.title, item.description, ...item.topics].join(" ").toLocaleLowerCase("ja");
        return { item, score: scoreHubInterestText(text, signals.interests) + (item.featured ? 5 : 0) - (seen.has(item.id) ? 20 : 0) - index / 1000 };
      }).sort((a, b) => b.score - a.score);
      const selected = ranked[0]?.item;
      if (!selected) return [];
      const matchedInterest = signals.interests.find((interest) => [selected.title, selected.description, ...selected.topics].join(" ").toLocaleLowerCase("ja").includes(interest.toLocaleLowerCase("ja")));
      const reason = matchedInterest
        ? `「${matchedInterest}」に関連`
        : seen.has(selected.id) ? "もう一度見る" : "まだ見ていない話題";
      return [{ ...selected, reason }];
    });
  }, [candidates, signals]);

  if (!signals || !recommendations.length) return null;

  return <section className="feature-panel feature-panel--standalone" aria-labelledby="cross-recommendations-title">
    <div className="feature-panel__heading">
      <div><span>RECOMMENDED</span><h2 id="cross-recommendations-title">おすすめ</h2></div>
      <small>端末内で選択</small>
    </div>
    <div className="rank-list">
      {recommendations.map((item, index) => <a className="rank-row" href={item.href} key={item.kind}>
        <b>{index + 1}</b>
        <span><small>{label(item.kind)}・{item.reason}</small><strong>{item.title}</strong></span>
        <i>見る</i>
      </a>)}
    </div>
  </section>;
}
