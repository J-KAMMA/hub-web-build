"use client";

import Link from "next/link";

import { V2Empty } from "@/components/v2/v2-empty";
import { useMemo, useState } from "react";

import { scoreHubInterestText } from "@/lib/hub-interest-profile";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";
import { V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { Avatar } from "@/components/v2/ui/avatar";
import { Tabs } from "@/components/v2/ui/tabs";

/*
 * コミュニティの一覧。既存の community-discovery.tsx から機能だけ抜いた。
 *
 * 落とさなかったもの: おすすめ／人気／新着、カテゴリと語の絞り込み、
 * 参加中のみ・人数、20件ずつ、押したら関心を記録。
 * おすすめは端末に残る関心プロファイルで並べる。サーバーは持っていないので
 * ここ（クライアント）で並べる。関心が空または無効なら人気順を初期候補に使う。
 *
 * 並びは既存の community-discovery.tsx に合わせる。ずらすと、v1とv2で
 * 「おすすめ」の中身が違って見える。
 */

export type V2CommunityCard = {
  id: string;
  slug: string;
  name: string;
  imageUrl?: string;
  description: string;
  category: string;
  createdAt: string;
  joined: boolean;
  pending: boolean;
  memberCount: number;
  channelCount: number;
  recentMemberCount: number;
  unread: number;
};

const PAGE = 20;

export function V2CommunityList({
  communities,
  mode,
  category,
  query,
  locale,
}: {
  communities: V2CommunityCard[];
  mode: "recommended" | "popular" | "new";
  category: string;
  query: string;
  locale: string;
}) {
  const ja = locale === "ja";
  const { interests, record } = useHubRecommendations();
  const feedback = useDiscoveryFeedback("community");
  const recommended = mode === "recommended" && !query.trim();
  const [count, setCount] = useState(PAGE);

  const sorted = useMemo(() => {
    const list = [...communities];
    if (mode === "new") {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else if (mode === "popular" || interests.length === 0) {
      list.sort((a, b) => b.memberCount - a.memberCount || b.recentMemberCount - a.recentMemberCount || a.name.localeCompare(b.name, "ja"));
    } else {
      list.sort((a, b) => {
        const scoreA = scoreHubInterestText(`${a.name} ${a.category} ${a.description}`, interests);
        const scoreB = scoreHubInterestText(`${b.name} ${b.category} ${b.description}`, interests);
        return scoreB - scoreA || b.memberCount - a.memberCount || a.name.localeCompare(b.name, "ja");
      });
    }
    return list;
  }, [communities, mode, interests]);
  const visible = sorted.filter(community => !recommended || !feedback.isHidden(community.id));

  const tabHref = (next: "recommended" | "popular" | "new") => {
    const params = new URLSearchParams();
    if (next !== "recommended") params.set("mode", next);
    if (category) params.set("category", category);
    if (query) params.set("q", query);
    const search = params.toString();
    return `/v2/community${search ? `?${search}` : ""}`;
  };

  return (
    <div className="v2-clist">
      <div className="v2-subtabs">
        <Tabs
          label={ja ? "並び順" : "Order"}
          value={mode}
          items={[
            { id: "recommended", label: ja ? "おすすめ" : "For you", href: tabHref("recommended") },
            { id: "popular", label: ja ? "人気" : "Popular", href: tabHref("popular") },
            { id: "new", label: ja ? "新着" : "New", href: tabHref("new") },
          ]}
        />
      </div>

      {recommended ? <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} /> : null}
      {visible.length ? (
        <ul className="v2-clist__grid">
          {visible.slice(0, count).map((community) => (
            <li key={community.id} className="v2-crow">
              <Link
                className="v2-ccard"
                href={`/v2/community?community=${encodeURIComponent(community.slug)}`}
                onClick={() => record("community", [community.category, community.name], 2)}
              >
                <Avatar name={community.name} src={community.imageUrl} size={48} shape="place" />
                <span className="v2-ccard__body">
                  <span className="v2-ccard__title">
                    <strong>{community.name}</strong>
                    {community.pending ? <em className="v2-badge v2-badge--warn">{ja ? "承認待ち" : "Pending"}</em> : null}
                    {community.unread > 0 ? <span className="v2-unread">{community.unread > 99 ? "99+" : community.unread}</span> : null}
                  </span>
                  <small className="v2-ccard__category">{community.category}</small>
                  <span className="v2-ccard__text">{community.description}</span>
                  <span className="v2-ccard__meta">
                    <span>{ja ? `${community.memberCount}人` : `${community.memberCount} members`}</span>
                    {community.recentMemberCount > 0 ? <span>{ja ? `今週 +${community.recentMemberCount}` : `+${community.recentMemberCount} this week`}</span> : null}
                  </span>
                </span>
              </Link>
              <span className="v2-crow__actions">
                {community.joined
                  ? <span className="v2-crow__joined">{ja ? "参加中" : "Joined"}</span>
                  : <Link className="ui-button ui-button--secondary" href={`/v2/community?community=${encodeURIComponent(community.slug)}`}>{ja ? "参加" : "Join"}</Link>}
                {recommended ? (
                  <details className="v2-crow__more">
                    <summary aria-label={ja ? "その他の操作" : "More actions"}>…</summary>
                    <div className="v2-crow__menu">
                      <button type="button" className="v2-discovery__dismiss v2-discovery__dismiss--inline" onClick={() => feedback.dismiss(community.id)}>{ja ? "興味なし" : "Not interested"}</button>
                    </div>
                  </details>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : recommended && sorted.length > 0 ? (
        <p className="v2-note">{ja ? "おすすめは非表示になっています。検索や別の並び順で探すか、設定で非表示をリセットできます。参加状態は変わりません。" : "Recommendations are hidden. Search, change sort or reset hidden recommendations in settings. Membership is unchanged."}</p>
      ) : (
        <V2Empty title={ja ? "該当するコミュニティがありません" : "No communities matched"} note={ja ? "語やカテゴリを変えてみてください。" : "Try another word or category."} action={{ label: ja ? "絞り込みを解除" : "Clear filters", href: "/v2/community" }} />
      )}

      {visible.length > count ? (
        <div className="v2-replies__more">
          <button type="button" className="v2-toggle v2-toggle--text" onClick={() => setCount((value) => value + PAGE)}>
            {ja ? "もっと見る" : "Show more"}
          </button>
          <small>{Math.min(count, visible.length)} / {visible.length}</small>
        </div>
      ) : null}
      {recommended && visible.length ? (
        <details className="v2-discovery v2-discovery--list v2-clist__adjust">
          <summary>{ja ? "おすすめの調整" : "Recommendation options"}</summary>
          <div className="v2-discovery__panel">
            <p>{interests.length ? (ja ? "端末に残る関心と、参加人数などのカタログ情報で並べています。" : "Ordered by interests kept on this device and catalog signals such as membership.") : (ja ? "参加人数などを基準に紹介しています。" : "Selected using membership and other catalog signals.")}</p>
            <p>{ja ? "各コミュニティの「興味なし」で、そのコミュニティを一覧から外せます。" : "Use “Not interested” on a community to remove it from this list."}</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
