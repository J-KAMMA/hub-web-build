import { ReactNode } from "react";
import { ShellFrame } from "@/components/shell-frame";
import { Sidebar } from "@/components/sidebar";
import { TimelineRail } from "@/components/timeline-rail";
import { hubMessages } from "@/lib/i18n";
import { getAppShellData, type AppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { buildHubSidebarItems } from "@/lib/sidebar-navigation";
import { HUBPEDIA_RAIL_ARTICLES } from "@/lib/encyclopedia/hubpedia-rail-catalog";
import { TranslationPreferenceProvider } from "@/components/translation-preference-provider";
import { getServerHubRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { ShellPageHeader } from "@/components/shell-page-header";

interface AppShellProps {
  currentPath: string;
  notificationCount?: number;
  messageCount?: number;
  children: ReactNode;
  shellData?: AppShellData;
  searchContext?: string;
  /* Set by layouts, which serve many paths through one fixed currentPath. */
  ownsHeading?: boolean;
}

export async function AppShell({
  currentPath,
  notificationCount,
  messageCount,
  children,
  shellData,
  searchContext = "",
  ownsHeading,
}: AppShellProps) {
  const locale = await getHubLocale();
  const copy = hubMessages(locale);
  const homeLayout = currentPath === "/";
  /* The feed answers at both paths, so the layout has to know both. */
  const feedLayout = currentPath === "/feed" || currentPath === "/";
  /*
   * The storefront brings its own scoped search and section tabs. Adding the
   * shell's page header above it stacked two search fields 50px apart with
   * nothing to say which one searched what. Only the three pages that render
   * the storefront are covered; the rest of /market has no search of its own.
   */
  /*
   * MarketHeader を出す画面はページヘッダーを持たない。MarketHeader が
   * 自前の検索（.storefront__search）を持っているので、両方出すと同じ用途の
   * 検索欄が二重になる。/market/search だけこの一覧から漏れており、
   * 「商品・サービスを検索」（ヘッダー）と「マーケットを検索」（画面内）が
   * どちらも name="q" で /market/search へ送る状態だった。
   * /market/tickets は MarketHeader を使わないので、この一覧には入れない。
   */
  const storefrontLayout = currentPath === "/market"
    || currentPath === "/market/products"
    || currentPath === "/market/digital"
    || currentPath === "/market/purchased"
    || currentPath === "/market/search";
  const communityLayout = currentPath === "/community";
  const marketLayout = currentPath === "/market" || currentPath.startsWith("/market/");
  const storeLayout = currentPath === "/store" || currentPath.startsWith("/store/") || marketLayout;
  const shoppingLayout = currentPath === "/shopping" || currentPath.startsWith("/shopping/") || currentPath === "/market/products" || currentPath.startsWith("/market/products/");
  const requestsLayout = currentPath === "/work" || currentPath.startsWith("/work/") || currentPath === "/jobs" || currentPath.startsWith("/jobs/") || currentPath === "/requests" || currentPath.startsWith("/requests/");
  const aiLayout = currentPath === "/ai";
  const computeLayout = currentPath === "/compute";
  const videoLayout = currentPath === "/videos" || currentPath.startsWith("/videos/");
  const musicLayout = currentPath === "/music" || currentPath.startsWith("/music/");
  const forumLayout = currentPath === "/bbs" || currentPath.startsWith("/bbs/") || currentPath.startsWith("/threads/");
  const searchLayout = currentPath === "/search";
  const hubpediaLayout = currentPath === "/hubpedia" || currentPath.startsWith("/hubpedia/");
  const articlesLayout = currentPath === "/articles";
  const adultLayout = currentPath === "/adult" || currentPath.startsWith("/adult/");
  const booksLayout = currentPath === "/books" || currentPath.startsWith("/books/");
  const showTimelineRail = !adultLayout && !articlesLayout;
  const {
    currentProfile,
    socialPosts,
    lists,
    follows,
    unreadIndicatorCount,
    unreadMessageCount,
  } = shellData ?? await getAppShellData({ relations: true });
  const resolvedNotificationCount = Math.max(
    unreadIndicatorCount,
    notificationCount ?? 0,
  );
  const resolvedMessageCount = Math.max(
    unreadMessageCount,
    messageCount ?? 0,
  );
  const decorateItems = (surface: "web" | "app") => buildHubSidebarItems(
    copy.nav,
    currentProfile.handle,
    resolvedNotificationCount,
    surface,
    resolvedMessageCount,
  )
    .map((item) => item.href === "/" ? { ...item, label: locale === "ja" ? "フィード" : "Feed" } : item)
    .map((item) => currentProfile.id && item.href.startsWith("/profile/") ? { ...item, label: currentProfile.displayName, avatarUrl: currentProfile.avatarUrl } : item)
    .map((item) => !currentProfile.id && (item.href === "/profile/guest" || item.href === "/settings") ? { ...item, iconHref: item.href, href: "/auth" } : item);

  const items = decorateItems("web");
  const mobileItems = decorateItems("app");
  const researchLayout = currentPath === "/research" || currentPath.startsWith("/research/");
  const wideContent = homeLayout || feedLayout || communityLayout || storeLayout || shoppingLayout
    || requestsLayout || aiLayout || computeLayout || videoLayout || searchLayout || hubpediaLayout
    || researchLayout || booksLayout || articlesLayout || adultLayout;

  /*
   * isOpen is stated here rather than left to the component default.
   * ShellFrame overrides it through cloneElement, but that override does not
   * reach this element on the server, so a default of true rendered an open
   * sidebar into the HTML while ShellFrame's own state was false: one
   * response carried shell--left-collapsed and an open .sidebar at once, and
   * hydration threw the whole tree away. ShellFrame starts closed, so this
   * has to start closed too. The layout effect opens it on desktop web
   * before paint.
   */
  const sidebar = <Sidebar
    items={items}
    mobileItems={mobileItems}
    currentPath={currentPath}
    currentProfile={currentProfile}
    locale={locale}
    messages={copy.sidebar}
    environment={getServerHubRuntimeEnvironment()}
    isOpen={false}
  />;

  return (
    <TranslationPreferenceProvider loadRemote={Boolean(currentProfile.id)}>
      <ShellFrame
        currentPath={currentPath}
        rightProfileId={currentProfile.id}
        wideContent={wideContent}
        shoppingContent={shoppingLayout}
        forumContent={forumLayout}
        left={sidebar}
        showTimelineRail={showTimelineRail}
        right={showTimelineRail ? <TimelineRail
          socialPosts={socialPosts}
          currentProfileId={currentProfile.id}
          follows={follows}
          lists={lists}
          // Match ShellFrame's closed initial state during SSR. ShellFrame
          // restores the desktop preference in its layout effect and then
          // overrides this prop through cloneElement.
          isOpen={false}
          hubpediaArticles={HUBPEDIA_RAIL_ARTICLES}
          locale={locale}
          deprioritizePostIds={feedLayout ? socialPosts.slice(0, 12).map((post) => post.id) : []}
          requestedMode={searchLayout ? "hubpedia" : "timeline"}
          standaloneMode={searchLayout}
          contextText={searchContext}
        /> : undefined}
      >
        {storefrontLayout || forumLayout || hubpediaLayout || videoLayout || musicLayout || adultLayout ? null : (
          <ShellPageHeader currentPath={currentPath} initialQuery={searchContext} ownsHeading={ownsHeading} />
        )}
        {children}
      </ShellFrame>
    </TranslationPreferenceProvider>
  );
}
