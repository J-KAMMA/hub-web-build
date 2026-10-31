"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import { COMMUNITY_CATEGORY_GROUPS, getCommunityCategoryOptions } from "@/lib/community-categories";
import type { CommunitySpace } from "@/lib/server/community-page-data";
import { HUB_INTEREST_PROFILE_CHANGED_EVENT, readHubInterestProfile, recordHubInterests, scoreHubInterestText, topHubInterests } from "@/lib/hub-interest-profile";
import { useCategoryAccordion } from "@/lib/use-category-accordion";
import { SavedQueryTabs } from "@/components/saved-query-tabs";
import { TabMainSearchHeader } from "@/components/tab-main-search-header";

function communityHref(community: CommunitySpace) {
  return `/community?community=${encodeURIComponent(community.slug)}`;
}

/*
 * How much is waiting in a community, summed over its channels. The count
 * lived only on the rail inside the workspace, so it could be seen only
 * from within a community — never from the screen where you pick one.
 */
function unreadCount(community: CommunitySpace) {
  return community.channels.reduce((total, channel) => total + channel.unreadCount, 0);
}

function communityInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "C";
}

export function nextCommunityVisibleCount(current: number, total: number) {
  return Math.min(total, current + 20);
}

export function CommunityDiscovery({
  communities,
  query = "",
  category = "すべて",
  mode = "recommended",
  membership = "all",
  minimumMembers = 0,
}: {
  communities: CommunitySpace[];
  query?: string;
  category?: string;
  mode?: "recommended" | "popular" | "new";
  membership?: "all" | "joined";
  minimumMembers?: number;
}) {
  const [sharedInterests, setSharedInterests] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const initialCategoryGroup = COMMUNITY_CATEGORY_GROUPS.find((group) => group.categories.includes(category as never));
  const { expandedCategoryKey, toggleCategory, collapseCategories } = useCategoryAccordion(initialCategoryGroup?.label ?? null);
  useEffect(() => {
    const syncInterests = () => setSharedInterests(topHubInterests(readHubInterestProfile()));
    syncInterests();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, syncInterests);
    return () => window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, syncInterests);
  }, []);
  const categories = [
    "すべて",
    ...getCommunityCategoryOptions(
      communities.map((community) => community.category),
    ),
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const preferredCategories = new Set(communities.filter((community) => community.joined).map((community) => community.category));
  const recommendationAvailable = preferredCategories.size > 0 || sharedInterests.length > 0;
  const effectiveMode = mode === "recommended" && !recommendationAvailable ? "popular" : mode;
  const currentViewParams = new URLSearchParams();
  if (query) currentViewParams.set("q", query);
  if (category !== "すべて") currentViewParams.set("category", category);
  if (mode !== "recommended") currentViewParams.set("mode", mode);
  if (membership !== "all") currentViewParams.set("membership", membership);
  if (minimumMembers) currentViewParams.set("minMembers", String(minimumMembers));
  const currentViewHref = currentViewParams.size
    ? `/community?${currentViewParams}`
    : "/community";
  const visible = communities
    .filter(
      (community) => category === "すべて" || community.category === category,
    )
    .filter((community) =>
      `${community.name} ${community.description} ${community.category}`
        .toLocaleLowerCase("ja")
        .includes(normalizedQuery),
    )
    .filter((community) => membership !== "joined" || community.joined)
    .filter((community) => community.memberIds.length >= minimumMembers)
    .sort((left, right) => {
      if (effectiveMode === "new") return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        || right.recentMemberCount - left.recentMemberCount;
      if (effectiveMode === "recommended") {
        const score = (community: CommunitySpace) => Number(preferredCategories.has(community.category)) * 100
          + scoreHubInterestText(`${community.name} ${community.description} ${community.category}`, sharedInterests) * 4
          + community.recentMemberCount * 3 + community.memberIds.length;
        return score(right) - score(left);
      }
      return right.memberIds.length - left.memberIds.length
        || right.recentMemberCount - left.recentMemberCount;
    });

  const joinedCommunities = communities.filter((community) => community.joined);
  const closeDirectory = () => setDirectoryOpen(false);

  /*
   * 2026-08-31、この画面だけ4列規格（外左列・中左列・本体・右列）に乗って
   * いなかった。目録を持たない画面のつもりで作られていたが、実際には
   * 「参加中のコミュニティ」と「カテゴリ」という縦の目録がある。それを本体へ
   * 押し込んだ結果、ページ名・検索・作成が一行に詰まり、検索欄はヘッダー行と
   * 二重になり、題名は127pxまで潰れて折り返していた。目録を中左列へ出し、
   * 検索は本体列の最上段（TabMainSearchHeader）へ移した。
   * これに伴い /community は lib/page-search-registry.ts から外している。
   * 両方に載せると同じ役割が二重になる（同ファイルの規約）。
   */
  return (
    <div className="community-discovery-layout bbs-directory-layout tab-left-column-layout">
      <button type="button" className="bbs-directory-mobile-toggle" aria-controls="community-directory" aria-expanded={directoryOpen} onClick={() => setDirectoryOpen((current) => !current)}>コミュニティ</button>
      {directoryOpen ? <button type="button" className="bbs-directory-backdrop" aria-label="コミュニティメニューを閉じる" onClick={closeDirectory} /> : null}
      <aside id="community-directory" data-hub-page-left-column className={`bbs-thread-directory tab-left-column${directoryOpen ? " bbs-thread-directory--open" : ""}`} aria-label="コミュニティメニュー">
        <header className="bbs-thread-directory__header tab-left-column__header">
          <strong>コミュニティ</strong>
          <button type="button" aria-label="コミュニティメニューを閉じる" onClick={closeDirectory}>×</button>
        </header>
        <nav className="bbs-thread-directory__nav community-discovery__directory" aria-label="コミュニティの絞り込み">
          {joinedCommunities.length ? <>
            <span className="community-discovery__directory-label">参加中</span>
            {joinedCommunities.map((community) => {
              const unread = unreadCount(community);
              return <Link
                href={communityHref(community)}
                key={community.id}
                onClick={closeDirectory}
                aria-label={unread > 0 ? `${community.name}（未読${unread}件）` : community.name}
              >
                <span>{community.imageUrl
                  ? <img className="community-discovery__directory-avatar" src={community.imageUrl} alt="" />
                  : <b className="community-discovery__directory-avatar">{communityInitial(community.name)}</b>}{community.name}</span>
                {unread > 0 ? <small>{unread > 99 ? "99+" : unread}</small> : null}
              </Link>;
            })}
          </> : null}

          <span className="community-discovery__directory-label">カテゴリ</span>
          <Link href="/community" aria-current={category === "すべて" ? "page" : undefined} onClick={() => { collapseCategories(); closeDirectory(); }}>すべて</Link>
          {COMMUNITY_CATEGORY_GROUPS.map((group) => {
            const expanded = expandedCategoryKey === group.label;
            const active = group.categories.includes(category as never);
            return <React.Fragment key={group.label}>
              <button type="button" className={active ? "is-active" : undefined} aria-expanded={expanded} aria-controls={`community-subcategories-${group.label}`} onClick={() => toggleCategory(group.label)}>
                {group.label}
              </button>
              {expanded ? <nav id={`community-subcategories-${group.label}`} className="community-discovery__category-picker" aria-label={`${group.label}の小カテゴリ`}>
                {group.categories.map((item) => {
                  const params = new URLSearchParams({ category: item });
                  if (query) params.set("q", query);
                  return <Link key={item} href={`/community?${params}`} aria-current={category === item ? "page" : undefined} onClick={closeDirectory}>{item}</Link>;
                })}
              </nav> : null}
            </React.Fragment>;
          })}

          <span className="community-discovery__directory-label">絞り込み</span>
          <form className="community-discovery__filters" action="/community">
            {category !== "すべて" && <input type="hidden" name="category" value={category} />}
            {query && <input type="hidden" name="q" value={query} />}
            <label><input type="checkbox" name="membership" value="joined" defaultChecked={membership === "joined"} />参加中のみ</label>
            <label>人数
              <select name="minMembers" defaultValue={String(minimumMembers)}>
                <option value="0">指定なし</option><option value="3">3人以上</option><option value="10">10人以上</option><option value="50">50人以上</option>
              </select>
            </label>
            <button type="submit">絞り込む</button>
          </form>

          <span className="community-discovery__directory-label">作る</span>
          <Link href="/community?create=1" onClick={closeDirectory}>コミュニティを作る</Link>
        </nav>
      </aside>

      <TabMainSearchHeader
        action="/community"
        ariaLabel="コミュニティを検索"
        placeholder="コミュニティ名・テーマを検索"
        defaultValue={query}
      />

      <div className="community-discovery bbs-directory-content tab-left-column-main">
      <SavedQueryTabs surface="community" currentValue={currentViewHref} />

      <nav className="content-discovery-tabs" aria-label="コミュニティの表示">
        {recommendationAvailable ? <Link href="/community" aria-current={effectiveMode === "recommended" ? "page" : undefined}>おすすめ</Link> : null}
        <Link href="/community?mode=popular" aria-current={effectiveMode === "popular" ? "page" : undefined}>人気</Link>
        <Link href="/community?mode=new" aria-current={effectiveMode === "new" ? "page" : undefined}>新着</Link>
      </nav>

      <section className="community-discovery__hero">
        <div>
          <h1>自分に合うコミュニティを見つけよう</h1>
        </div>
        <dl>
          <div>
            <dt>コミュニティ</dt>
            <dd>{communities.length}</dd>
          </div>
          <div>
            <dt>カテゴリ</dt>
            <dd>{Math.max(0, categories.length - 1)}</dd>
          </div>
        </dl>
      </section>

      <section className="community-discovery__results">
        <header>
          <div>
            {category !== "すべて" ? <small>{category}</small> : null}
            <h2>{query ? `「${query}」の検索結果` : "注目のコミュニティ"}</h2>
          </div>
          <span>{visible.length}件</span>
        </header>
        <div className="community-discovery__grid">
          {visible.slice(0, visibleCount).map((community) => (
            <Link
              className="community-discovery-card"
              href={communityHref(community)}
              key={community.id}
              onClick={() => recordHubInterests("community", [community.category, community.name], 2)}
            >
              <span className="community-discovery-card__cover">
                {community.imageUrl ? (
                  <img src={community.imageUrl} alt="" />
                ) : (
                  <strong>{Array.from(community.name)[0]}</strong>
                )}
              </span>
              <span className="community-discovery-card__body">
                <span className="community-discovery-card__title">
                  <strong>{community.name}</strong>
                  {community.joined && <em>参加中</em>}
                </span>
                <small>{community.category}</small>
                <p>{community.description}</p>
                <span className="community-discovery-card__meta">
                  <span>{community.memberIds.length}人</span>
                  <span>{community.channels.length}チャンネル</span>
                  {community.recentMemberCount > 0 && (
                    <span>今週 +{community.recentMemberCount}</span>
                  )}
                </span>
              </span>
            </Link>
          ))}
        </div>
        {visible.length > visibleCount ? <div className="search-load-more"><button type="button" onClick={() => setVisibleCount((count) => nextCommunityVisibleCount(count, visible.length))}>もっと見る</button><small>{visibleCount} / {visible.length}</small></div> : null}
        {visible.length === 0 && (
          <div className="community-discovery__empty">
            <strong>該当するコミュニティがありません</strong>
            <p>検索語またはカテゴリを変更してみてください。</p>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
