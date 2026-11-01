import type { Metadata } from "next";
import { ResearchDiscovery } from '@/components/research-discovery';
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2CommunityList, type V2CommunityCard } from "@/components/v2/v2-community-list";
import { V2CommunityWorkspace, type V2CommunityWorkspaceData } from "@/components/v2/v2-community-workspace";
import { CommunityWorkspace, type CommunityEmbeddedSection } from "@/components/community-workspace";
import { Tabs } from "@/components/v2/ui/tabs";
import { ButtonLink } from "@/components/v2/ui/button";
import { V2Shell } from "@/components/v2/v2-shell";
import { COMMUNITY_CATEGORY_GROUPS } from "@/lib/community-categories";
import { isHubOperator, isInstanceOperator } from "@/lib/hub-operators";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hubCategorySearchText } from "@/lib/hub-taxonomy";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { getCommunityPageData, type CommunitySpace } from "@/lib/server/community-page-data";
import { socialStreamReturnHref } from "@/lib/social-stream-return";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../community.css";
import "../../../community-overview.css";
import "../../../community-home.css";
import "../../../community-polish.css";
import "../../v2.css";
import "../../redesign-sns.css";
import "../../v2-luxe.css";
import "../../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "コミュニティ | Hub v2",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function unread(community: CommunitySpace) {
  return community.channels.reduce((total, channel) => total + channel.unreadCount, 0);
}

function toCard(community: CommunitySpace): V2CommunityCard {
  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    imageUrl: community.imageUrl,
    description: community.description,
    category: community.category,
    createdAt: community.createdAt,
    joined: community.joined,
    pending: Boolean(community.pendingMembershipRequest),
    memberCount: community.memberIds.length,
    channelCount: community.channels.length,
    recentMemberCount: community.recentMemberCount,
    unread: unread(community),
  };
}

/*
 * v2 のコミュニティ。既存の /community には触れない。
 * データは既存の getCommunityPageData をそのまま使う（一覧も中も同じ1回の取得）。
 *
 * ?community= が無ければ一覧、あれば中。中ではチャンネルの会話を出し、
 * メンバー・ガイド・ガバナンス・トークン・運営の設定は ?section= で本文に埋める
 * （2026-09-07 まで既存の画面へ渡していた）。入口は内側左列。
 */
export default async function V2CommunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const streamReturn = socialStreamReturnHref(params.returnTo), backHref = streamReturn ?? "/v2/community";
  const returnQuery = streamReturn ? `&returnTo=${encodeURIComponent(streamReturn)}` : "";
  const backLabel = streamReturn ? (japanese ? "タイムラインへ戻る" : "Back to timeline") : (japanese ? "一覧へ戻る" : "All communities");
  const ref = one(params.community).trim();
  const channelRef = one(params.channel).trim();
  const sectionRef = one(params.section);
  const requestedSection: CommunityEmbeddedSection | null = (["members", "guides", "governance", "tokens", "settings"] as const).find((item) => item === sectionRef) ?? null;
  const category = one(params.category).trim().slice(0, 100);
  const query = one(params.q).trim().slice(0, 100);
  const requestedMode = one(params.mode);
  const mode: "recommended" | "popular" | "new" = requestedMode === "popular" || requestedMode === "new" ? requestedMode : "recommended";
  const joinedOnly = one(params.membership) === "joined";
  const minMembers = Math.max(0, /^\d+$/.test(one(params.minMembers)) ? Number(one(params.minMembers)) : 0);

  /*
   * The viewer is resolved once per request (getHubViewer is memoised), the shell already
   * supplies the unread counts, and the operator-roster lookup needs only the viewer id, so
   * all three run together instead of the roster waiting for the page data.
   */
  const viewerPromise = getHubViewer();
  const operatorDatabase = getOptionalHubD1();
  const [{ currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount }, data, isOperator] = await Promise.all([
    getAppShellData(),
    viewerPromise.then((viewer) => getCommunityPageData({ selectedCommunityRef: ref || undefined, viewer, skipCounts: true })),
    viewerPromise.then((viewer) => {
      const viewerId = viewer?.id ?? "";
      return operatorDatabase
        ? isInstanceOperator(operatorDatabase, viewerId, process.env.HUB_OPERATOR_PROFILE_IDS)
        : isHubOperator(viewerId, process.env.HUB_OPERATOR_PROFILE_IDS);
    }),
  ]);

  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });
  const library = await loadViewerLibrary(currentProfile.id, "feed", japanese);
  const directory = <V2LibraryColumn data={library} signedIn={Boolean(currentProfile.id)} japanese={japanese} next="/v2/community" />;

  /*
   * 認証審査の入口（2026-09-04）。
   *
   * /v2/community/review は運営者だけの画面で、どこからも指されていなかった。
   * 判定は API（app/api/community-verification/route.ts）と同じ環境の名簿を読む。
   * 運営者でない人には出さない——押しても 403 になる入口は入口ではない。
   */
  const joined = data.communities.filter((community) => community.joined);
  const selected = ref
    ? data.communities.find((community) => community.id === ref || community.slug === ref) ?? null
    : null;

  const aside = (
    <V2Aside
      posts={socialPosts}
      japanese={japanese}
      signedIn={Boolean(currentProfile.id)}
      viewerId={currentProfile.id}
      initialView="community"
      title={japanese ? "並べて見る" : "Alongside"}
    />
  );

  /* ---- 中 ---------------------------------------------------------- */
  if (selected) {
    const channels = [...selected.channels].sort((a, b) => a.position - b.position);
    const channel = channels.find((item) => item.id === channelRef) ?? channels[0] ?? null;
    const workspace: V2CommunityWorkspaceData = {
      id: selected.id,
      slug: selected.slug,
      name: selected.name,
      description: selected.description,
      visibility: selected.visibility ?? "public",
      joined: selected.joined,
      pending: Boolean(selected.pendingMembershipRequest),
      viewerRole: selected.viewerRole,
      viewerStatus: selected.viewerStatus ?? null,
      memberCount: selected.memberIds.length,
      channels: channels.map((item) => ({ id: item.id, name: item.name, description: item.description, unreadCount: item.unreadCount })),
    };
    /*
     * 運営の節（2026-09-07、旦那様の決定）。内側左列に節を並べ、本文に選んだ節だけを出す。
     * 中身は既存の部品（community-workspace.tsx）を節だけ開いた形で埋める。
     * 2026-09-04 から今日までは既存の画面へ渡していた——「全部を v2 に」の最後の1つ。
     */
    const sectionHref = (item: CommunityEmbeddedSection) => `/v2/community?community=${encodeURIComponent(selected.slug)}&section=${item}${returnQuery}`;
    const sections: { id: CommunityEmbeddedSection; label: string }[] = [
      { id: "members", label: japanese ? `メンバー ${selected.memberIds.length}` : `Members ${selected.memberIds.length}` },
      ...(selected.guides?.length ? [{ id: "guides" as const, label: japanese ? `ガイド ${selected.guides.length}` : `Guides ${selected.guides.length}` }] : []),
      ...(selected.governanceMode === "dao" ? [{ id: "governance" as const, label: japanese ? "ガバナンス" : "Governance" }] : []),
      ...(selected.tokens?.length ? [{ id: "tokens" as const, label: japanese ? "トークン" : "Tokens" }] : []),
      ...(selected.viewerRole === "owner" || selected.viewerRole === "moderator" ? [{ id: "settings" as const, label: japanese ? "運営の設定" : "Settings" }] : []),
    ];
    /* 一覧に無い節（運営でない人の settings、トークンの無いコミュニティの tokens）は開かない。 */
    const section = sections.some((item) => item.id === requestedSection) ? requestedSection : null;
    const sectionLabel = sections.find((item) => item.id === section)?.label ?? null;

    /* タブ行: チャンネル（最大7。選択中は必ず含む）。残りと運営の節は「絞り込み」の中。 */
    const shownChannels = channels.slice(0, 7);
    if (channel && !shownChannels.some((item) => item.id === channel.id)) shownChannels[shownChannels.length - 1] = channel;
    const hiddenChannels = channels.filter((item) => !shownChannels.some((shown) => shown.id === item.id));
    const channelLink = (item: (typeof channels)[number]) => (
      <li key={item.id}>
        <Link
          className="v2-nav__item"
          href={`/v2/community?community=${encodeURIComponent(selected.slug)}&channel=${encodeURIComponent(item.id)}${returnQuery}`}
          aria-current={!section && channel?.id === item.id ? "page" : undefined}
        >
          <span className="v2-nav__label">#{item.name}</span>
          {item.unreadCount > 0 ? <span className="v2-nav__count">{item.unreadCount > 99 ? "99+" : item.unreadCount}</span> : null}
        </Link>
      </li>
    );
    const channelTabs = (
      <div className="v2-subtabs">
        <Tabs
          label={japanese ? "チャンネル" : "Channels"}
          value={section ? "" : channel?.id ?? ""}
          items={shownChannels.map((item) => ({
            id: item.id,
            label: `#${item.name}`,
            href: `/v2/community?community=${encodeURIComponent(selected.slug)}&channel=${encodeURIComponent(item.id)}${returnQuery}`,
            count: item.unreadCount > 0 ? item.unreadCount : undefined,
          }))}
        />
      </div>
    );
    const insideFilters = hiddenChannels.length || sections.length ? (
      <details className="v2-filter-disclosure" open={section ? true : undefined}>
        <summary>{japanese ? "絞り込み" : "Filter"}</summary>
        <div className="v2-filter-disclosure__body">
          {hiddenChannels.length ? (
            <>
              <p className="v2-column__title">{japanese ? "ほかのチャンネル" : "More channels"}</p>
              <ul className="v2-nav__list">{hiddenChannels.map(channelLink)}</ul>
            </>
          ) : null}
          {sections.length ? (
            <>
              <p className="v2-column__title">{japanese ? "運営" : "Manage"}</p>
              <ul className="v2-nav__list">
                {sections.map((item) => (
                  <li key={item.id}>
                    <Link className="v2-nav__item" href={sectionHref(item.id)} aria-current={section === item.id ? "page" : undefined}>
                      <span className="v2-nav__label">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </details>
    ) : null;

    return (
      <V2Shell skin="luxe" currentPath="/v2/community" profile={currentProfile} items={items} directory={directory} aside={aside} japanese={japanese}>
        <V2ColumnHead
          heading
          title={sectionLabel ?? (channel ? `#${channel.name}` : selected.name)}
          action={<>
            <span className="v2-heading__note">{selected.name}</span>
            <Link className="v2-heading__note" href={backHref}>{streamReturn ? backLabel : japanese ? "← 一覧へ" : "← All communities"}</Link>
          </>}
        />
        {shownChannels.length > 0 ? channelTabs : null}
        {insideFilters}
        {section ? (
          <CommunityWorkspace
            communities={data.communities}
            members={data.members}
            boards={data.boards}
            authenticated={data.authenticated}
            locale={locale}
            initialCommunityId={selected.id}
            embedded={section}
          />
        ) : (
        <V2CommunityWorkspace
          community={workspace}
          returnTo={streamReturn ?? undefined}
          channel={channel ? { id: channel.id, name: channel.name, description: channel.description, unreadCount: channel.unreadCount } : null}
          initialMessages={channel?.messages ?? []}
          members={data.members.map((member) => ({ id: member.id, displayName: member.displayName, handle: member.handle, avatarUrl: member.avatarUrl }))}
          viewerId={currentProfile.id ?? ""}
          locale={locale}
        />
        )}
        <ResearchDiscovery kind="community" targetId={selected.id} sourceContext={{channelId:channel?.id,returnTo:streamReturn??undefined}}/>
      </V2Shell>
    );
  }

  /* ---- 一覧 -------------------------------------------------------- */
  const normalizedQuery = query ? hubCategorySearchText(query).toLocaleLowerCase("ja") : "";
  const visible = data.communities.filter((community) => {
    if (category && community.category !== category) return false;
    if (joinedOnly && !community.joined) return false;
    if (minMembers && community.memberIds.length < minMembers) return false;
    if (normalizedQuery) {
      const haystack = hubCategorySearchText(`${community.name} ${community.description} ${community.category}`).toLocaleLowerCase("ja");
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });

  const href = (patch: Record<string, string | undefined>) => {
    const merged = { category, q: query, mode: requestedMode, membership: joinedOnly ? "joined" : "", minMembers: minMembers ? String(minMembers) : "", ...patch };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const search = next.toString();
    return `/v2/community${search ? `?${search}` : ""}`;
  };

  const activeGroup = COMMUNITY_CATEGORY_GROUPS.find((group) => (group.categories as readonly string[]).includes(category));

  const filters = (
    <details className="v2-filter-disclosure" open={category || joinedOnly || minMembers ? true : undefined}>
      <summary>{japanese ? "絞り込み" : "Filter"}</summary>
      <div className="v2-filter-disclosure__body">
      {joined.length ? (
        <>
          <p className="v2-column__title">{japanese ? "参加中" : "Joined"}</p>
          <ul className="v2-nav__list">
            {joined.map((community) => {
              const count = unread(community);
              return (
                <li key={community.id}>
                  <Link className="v2-nav__item" href={`/v2/community?community=${encodeURIComponent(community.slug)}`}>
                    <span className="v2-nav__label">{community.name}</span>
                    {count > 0 ? <span className="v2-nav__count">{count > 99 ? "99+" : count}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <p className="v2-column__title">{japanese ? "カテゴリ" : "Categories"}</p>
      <ul className="v2-nav__list">
        <li>
          <Link className="v2-nav__item" href={href({ category: "" })} aria-current={!category ? "page" : undefined}>
            <span className="v2-nav__label">{japanese ? "すべて" : "All"}</span>
          </Link>
        </li>
        {COMMUNITY_CATEGORY_GROUPS.map((group) => {
          const open = activeGroup?.label === group.label;
          return (
            <li key={group.label}>
              <details open={open}>
                <summary className="v2-nav__item">
                  <span className="v2-nav__label">{group.label}</span>
                </summary>
                <ul className="v2-nav__list v2-nav__list--nested">
                  {group.categories.map((item) => (
                    <li key={item}>
                      <Link className="v2-nav__item" href={href({ category: item })} aria-current={category === item ? "page" : undefined}>
                        <span className="v2-nav__label">{item}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>

      <form className="v2-filter" action="/v2/community" method="get">
        {category ? <input type="hidden" name="category" value={category} /> : null}
        {query ? <input type="hidden" name="q" value={query} /> : null}
        {requestedMode ? <input type="hidden" name="mode" value={requestedMode} /> : null}
        <label className="v2-filter__row">
          <input type="checkbox" name="membership" value="joined" defaultChecked={joinedOnly} />
          <span>{japanese ? "参加中のみ" : "Joined only"}</span>
        </label>
        <label className="v2-filter__row">
          <span>{japanese ? "人数" : "Members"}</span>
          <select name="minMembers" defaultValue={String(minMembers)}>
            <option value="0">{japanese ? "指定なし" : "Any"}</option>
            <option value="3">{japanese ? "3人以上" : "3+"}</option>
            <option value="10">{japanese ? "10人以上" : "10+"}</option>
            <option value="50">{japanese ? "50人以上" : "50+"}</option>
          </select>
        </label>
        <button type="submit" className="v2-toggle v2-toggle--text">{japanese ? "絞り込む" : "Apply"}</button>
      </form>

      </div>
    </details>
  );

  return (
    <V2Shell skin="luxe" currentPath="/v2/community" profile={currentProfile} items={items} directory={directory} aside={aside} japanese={japanese}>
      <V2ColumnHead
        heading
        title={category || (japanese ? "コミュニティ" : "Communities")}
        action={<>
          <span className="v2-heading__note">{japanese ? `${data.communities.length}件` : `${data.communities.length} communities`}</span>
          {isOperator ? <Link className="v2-heading__note" href="/v2/community/review">{japanese ? "認証審査" : "Verification review"}</Link> : null}
          <Link className="v2-heading__note" href="/v2/community/games">{japanese ? "ゲーム" : "Games"}</Link>
          <Link className="v2-heading__note" href="/v2/community/remote">{japanese ? "他のハブ" : "Other Hubs"}</Link>
          <ButtonLink variant="primary" href="/v2/community/new" label={japanese ? "作る" : "Create"} />
        </>}
      />

      <form className="v2-search__form" role="search" action="/v2/community" method="get">
        {category ? <input type="hidden" name="category" value={category} /> : null}
        {requestedMode ? <input type="hidden" name="mode" value={requestedMode} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={query}
          maxLength={100}
          placeholder={japanese ? "コミュニティ名・テーマを検索" : "Search communities"}
          aria-label={japanese ? "コミュニティを検索" : "Search communities"}
        />
        <button type="submit" className="v2-search__submit">{japanese ? "検索" : "Search"}</button>
      </form>

      {filters}

      {category || query || joinedOnly || minMembers ? (
        <p className="v2-note">
          {category ? <span className="v2-badge">{category}</span> : null}
          {query ? <span className="v2-badge">{query}</span> : null}
          {joinedOnly ? <span className="v2-badge">{japanese ? "参加中のみ" : "Joined only"}</span> : null}
          {minMembers ? <span className="v2-badge">{japanese ? `${minMembers}人以上` : `${minMembers}+`}</span> : null}
          {" "}
          <Link className="v2-card__link" href="/v2/community">{japanese ? "絞り込みを解除" : "Clear"}</Link>
        </p>
      ) : null}

      <V2CommunityList communities={visible.map(toCard)} mode={mode} category={category} query={query} locale={locale} />
    </V2Shell>
  );
}
