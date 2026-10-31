import { filterOptionalNav } from "./optional-services";

type SidebarNavigationEntry = {
  href: string;
  group: HubNavigationGroup;
  labelIndex?: number;
  label?: string;
  showsNotificationBadge?: boolean;
  showsMessageBadge?: boolean;
};

export type HubNavigationGroup =
  | "main"
  | "inbox"
  | "conversation"
  | "works"
  | "knowledge"
  | "market"
  | "organize"
  | "account";

export const HUB_NAVIGATION_GROUPS = [
  "conversation",
  "inbox",
  "works",
  "knowledge",
  "market",
  "main",
  "organize",
  "account",
] as const satisfies readonly HubNavigationGroup[];

const HUB_NAVIGATION_GROUP_LABELS: Record<HubNavigationGroup, { ja: string; en: string }> = {
  main: { ja: "ツール", en: "Tools" },
  /*
   * What was addressed to you, kept apart from the places you go: the feed,
   * the threads and the communities are somewhere to read, while these two
   * are a queue with your name on it — and the only entries that carry an
   * unread count.
   */
  inbox: { ja: "自分宛て", en: "For you" },
  conversation: { ja: "交流", en: "Connect" },
  works: { ja: "作品", en: "Works" },
  knowledge: { ja: "知識・制作", en: "Knowledge & Creation" },
  market: { ja: "マーケット", en: "Market" },
  organize: { ja: "整理", en: "Organize" },
  account: { ja: "アカウント", en: "Account" },
};

export function getHubNavigationGroupLabel(group: HubNavigationGroup, locale: string): string {
  return locale === "ja"
    ? HUB_NAVIGATION_GROUP_LABELS[group].ja
    : HUB_NAVIGATION_GROUP_LABELS[group].en;
}

const NAVIGATION_CATALOG = {
  /*
   * One entry, not two. The root renders the feed now, so a separate home
   * item pointed at the same screen — and what used to stand there was a
   * copy of this very column.
   *
   * It belongs with the threads and the communities rather than above them:
   * it is one of the places people talk, and the column should say so.
   */
  feed: { href: "/", group: "conversation", label: "フィード" },
  search: { href: "/search", group: "main", labelIndex: 1 },
  notifications: { href: "/notifications", group: "inbox", labelIndex: 2, showsNotificationBadge: true },
  messages: { href: "/messages", group: "inbox", labelIndex: 3, showsMessageBadge: true },
  bbs: { href: "/bbs", group: "conversation", labelIndex: 5 },
  community: { href: "/community", group: "conversation", labelIndex: 7 },
  hubpedia: { href: "/hubpedia", group: "knowledge", labelIndex: 6 },
  research: { href: "/research", group: "knowledge", label: "プロジェクトと研究" },
  articles: { href: "/articles", group: "works", label: "記事" },
  videos: { href: "/videos", group: "works", labelIndex: 13 },
  /*
   * Books are something you own, so they belong in the purchased library
   * rather than in a row of their own. Kept in the catalogue while that
   * page grows a shelf for them.
   */
  books: { href: "/books", group: "market", label: "Books" },
  music: { href: "/music", group: "works", labelIndex: 15 },
  world: { href: "/world", group: "knowledge", label: "3Dワールド" },
  ranking: { href: "/ranking", group: "knowledge", labelIndex: 4 },
  market: { href: "/market", group: "market", label: "マーケット" },
  purchased: { href: "/market/purchased", group: "market", label: "購入済み" },
  ai: { href: "/ai", group: "main", labelIndex: 17 },
  compute: { href: "/compute", group: "organize", label: "Compute" },
  lists: { href: "/lists", group: "organize", labelIndex: 8 },
  bookmarks: { href: "/bookmarks", group: "organize", labelIndex: 9 },
  /*
   * In the catalogue, out of the column. The services page is an index of
   * destinations this very column already lists, and the node dashboard is
   * reached from the Personal Node section of the settings — neither earns
   * a standing row in front of someone all day, and the column ran past the
   * bottom of the window with them in it.
   */
  node: { href: "/node", group: "organize", label: "パーソナルノード" },
  services: { href: "/services", group: "organize", label: "サービス" },

  profile: { href: "/profile/:handle", group: "account", labelIndex: 11 },
  wallet: { href: "/wallet", group: "account", label: "ウォレット" },
  settings: { href: "/settings", group: "account", labelIndex: 12 },
} as const satisfies Record<string, SidebarNavigationEntry>;

/*
 * Both orders keep every group contiguous so the rendered list breaks into a
 * few readable runs instead of one flat wall of destinations. Groups stay
 * ordering metadata: the sidebar draws a rule where the group changes and
 * still renders no group headings.
 */
export const HUB_WEB_SIDEBAR_ORDER = [
  "feed", "bbs", "community",
  "notifications", "messages",
  "videos", "music", "articles",
  "research", "world",
  "market", "purchased",
  "ai", "search",
  "bookmarks", "lists",
  "wallet", "profile", "settings",
] as const;

export const HUB_APP_SIDEBAR_ORDER = HUB_WEB_SIDEBAR_ORDER;

export type HubSidebarSurface = "web" | "app";

export function buildHubSidebarItems(
  labels: readonly string[],
  profileHandle: string,
  notificationCount: number,
  surface: HubSidebarSurface = "web",
  messageCount = 0,
) {
  const order = surface === "app" ? HUB_APP_SIDEBAR_ORDER : HUB_WEB_SIDEBAR_ORDER;
  const enabledOrder = filterOptionalNav(order.map((key) => ({ key, href: NAVIGATION_CATALOG[key].href }))).map((item) => item.key);
  return enabledOrder.map((key) => {
      const entry = NAVIGATION_CATALOG[key];
      return {
        href: entry.href === "/profile/:handle" ? `/profile/${profileHandle}` : entry.href,
        group: entry.group,
        label: "label" in entry
          ? entry.label
          : labels[entry.labelIndex],
        ...("showsNotificationBadge" in entry && entry.showsNotificationBadge
          ? { badge: notificationCount }
          : {}),
        ...("showsMessageBadge" in entry && entry.showsMessageBadge
          ? { badge: messageCount }
          : {}),
    };
  });
}
