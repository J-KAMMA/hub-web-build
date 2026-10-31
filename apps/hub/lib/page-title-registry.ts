import { HUB_PAGE_UI_REGISTRY } from "@/lib/generated-page-ui-registry";

export type HubPageTitle = {
  title: string;
  parent?: string;
  iconHref: string;
  /*
   * The path this title actually names. A rule declared with under() also
   * answers for everything beneath it, where the title describes the section
   * rather than the page: on an article, "Hubpedia" is not the heading, the
   * article name is. The header needs to tell the two apart, so each rule
   * carries the path it was declared with.
   */
  section: string;
};

type Matcher = ((path: string) => boolean) & { section: string };
/*
 * sectionHref exists for the families whose name and whose home are different
 * paths. A thread lives under /threads, and the place it belongs to is /bbs;
 * without the override the header could only offer the reader a path that
 * answers with nothing.
 */
type Rule = Omit<HubPageTitle, "section"> & { match: Matcher; sectionHref?: string };

const exact = (path: string): Matcher =>
  Object.assign((current: string) => current === path, { section: path });
const under = (path: string): Matcher =>
  Object.assign(
    (current: string) => current === path || current.startsWith(`${path}/`),
    { section: path },
  );

const RULES: readonly Rule[] = [
  /* v2（app/v2）。既存と同じ名前を返す。画面は別でも、場所の名前は同じ。 */
  { match: under("/v2/search"), title: "検索", iconHref: "/v2/search" },
  { match: under("/v2/community"), title: "コミュニティ", iconHref: "/v2/community" },
  { match: under("/v2/bbs"), title: "スレッド", iconHref: "/v2/bbs" },
  { match: under("/v2/threads"), title: "スレッド", iconHref: "/v2/bbs", sectionHref: "/v2/bbs" },
  { match: under("/v2/posts"), title: "投稿", iconHref: "/v2" },
  { match: under("/v2/studio/videos"), title: "動画の投稿", iconHref: "/v2/videos" },
  { match: under("/v2/videos"), title: "動画", iconHref: "/v2/videos" },
  { match: under("/v2/music"), title: "音楽", iconHref: "/v2/music" },
  { match: under("/v2/articles"), title: "記事", iconHref: "/v2/articles" },
  { match: under("/v2/market"), title: "マーケット", iconHref: "/v2/market" },
  { match: under("/v2/notifications"), title: "通知", iconHref: "/v2/notifications" },
  { match: under("/v2/messages"), title: "メッセージ", iconHref: "/v2/messages" },
  { match: under("/v2/profile"), title: "プロフィール", iconHref: "/v2" },
  { match: under("/v2/operator/federation"), title: "連合の方針", parent: "運営", iconHref: "/v2/settings" },
  { match: under("/v2/settings"), title: "設定", iconHref: "/v2/settings" },
  { match: under("/v2/wallet/pay"), title: "支払い", parent: "アカウント", iconHref: "/v2/account" },
  { match: under("/v2/wallet/tax"), title: "税務", parent: "アカウント", iconHref: "/v2/account" },
  { match: under("/v2/wallet"), title: "ウォレット", iconHref: "/v2/wallet" },
  { match: under("/v2/bookmarks"), title: "ブックマーク", iconHref: "/v2/bookmarks" },
  { match: under("/v2/commissions"), title: "依頼", iconHref: "/v2/commissions" },
  { match: under("/v2/boards"), title: "ボード", iconHref: "/v2/boards" },
  { match: under("/v2/lists"), title: "リスト", iconHref: "/v2/lists" },
  { match: under("/v2/hubpedia"), title: "Hubpedia", iconHref: "/v2/hubpedia" },
  { match: under("/v2/feed"), title: "フィード", iconHref: "/v2" },
  { match: under("/v2/account"), title: "アカウント", iconHref: "/v2/account" },
  { match: under("/v2/onboarding"), title: "Hubをはじめる", iconHref: "/v2" },
  { match: under("/v2/work"), title: "依頼・スキル", iconHref: "/v2/market" },
  { match: under("/v2/jobs"), title: "求人", iconHref: "/v2/market" },
  { match: under("/v2/local-services"), title: "地域サービス", iconHref: "/v2/market" },
  { match: under("/v2/services"), title: "すべての機能", iconHref: "/v2" },
  { match: under("/v2/events"), title: "イベント", iconHref: "/v2/market" },
  { match: under("/v2/classes"), title: "講座", iconHref: "/v2/market" },
  { match: under("/v2/travel"), title: "旅行", iconHref: "/v2/market" },
  { match: under("/v2/research"), title: "研究", iconHref: "/v2" },
  { match: under("/v2/code"), title: "コード", iconHref: "/v2" },
  { match: under("/v2/world"), title: "3Dワールド", iconHref: "/v2" },
  { match: under("/v2/games"), title: "ゲーム", iconHref: "/v2" },
  { match: under("/v2/books"), title: "本", iconHref: "/v2" },
  { match: under("/v2/creator"), title: "Creator Center", iconHref: "/v2/account" },
  { match: under("/v2/earnings"), title: "収益", iconHref: "/v2/account" },
  { match: under("/v2/node"), title: "Personal Node", iconHref: "/v2/account" },
  { match: under("/v2/compute"), title: "計算", iconHref: "/v2" },
  { match: under("/v2/intent"), title: "意図", iconHref: "/v2" },
  { match: under("/v2/token"), title: "トークン", iconHref: "/token" },
  { match: under("/v2/store"), title: "ストア", iconHref: "/v2/market" },
  { match: under("/v2/ai"), title: "AI", iconHref: "/v2" },
  { match: under("/v2/tag"), title: "タグ", iconHref: "/v2/search" },
  { match: under("/v2/advertising"), title: "広告", iconHref: "/v2" },
  { match: under("/v2/ads"), title: "広告", iconHref: "/v2" },
  { match: under("/v2/appeal"), title: "異議申し立て", iconHref: "/v2" },
  { match: under("/v2/copyright"), title: "著作権", iconHref: "/v2/about" },
  { match: under("/v2/developers"), title: "開発者サービス", iconHref: "/v2" },
  /* 規約は本文を v1 と共有している。戻り先だけ面ごとに変える（2026-09-05）。 */
  { match: under("/v2/privacy"), title: "プライバシー", iconHref: "/v2/about" },
  { match: under("/v2/terms"), title: "利用規約", iconHref: "/v2/about" },
  { match: under("/v2/legal"), title: "サービス条件", iconHref: "/v2/about" },
  { match: under("/v2/about"), title: "Hubについて", iconHref: "/v2/about" },
  { match: under("/v2/auth"), title: "ログイン", iconHref: "/v2" },
  /* 成人向けは v2 にも出した（2026-09-05）。区分は分けたまま。 */
  { match: under("/v2/adult"), title: "記事", iconHref: "/v2/articles" },
  /* 存在しない v2 の道の受け皿（app/v2/[...missing]）。404 画面の名前。 */
  { match: exact("/v2/[...missing]"), title: "ページが見つかりません", iconHref: "/v2" },
  { match: exact("/v2"), title: "フィード", iconHref: "/v2" },
  { match: under("/profile"), title: "プロフィール", iconHref: "/account" },
  { match: under("/posts"), title: "投稿", iconHref: "/feed" },
  { match: under("/notifications"), title: "通知", iconHref: "/notifications" },
  { match: under("/messages"), title: "メッセージ", iconHref: "/messages" },
  { match: exact("/articles/new"), title: "記事を書く", parent: "記事", iconHref: "/articles" },
  { match: under("/articles"), title: "記事", iconHref: "/articles" },
  { match: under("/hubpedia/papers"), title: "論文", parent: "Hubpedia", iconHref: "/hubpedia" },
  { match: under("/hubpedia/watchlist"), title: "ウォッチリスト", parent: "Hubpedia", iconHref: "/hubpedia" },
  { match: under("/hubpedia/about"), title: "Hubpediaについて", parent: "Hubpedia", iconHref: "/hubpedia" },
  { match: under("/hubpedia"), title: "Hubpedia", iconHref: "/hubpedia" },
  { match: under("/adult"), title: "記事", iconHref: "/articles" },
  { match: under("/books"), title: "Books", iconHref: "/books" },
  { match: under("/community/invite"), title: "コミュニティへ参加", parent: "コミュニティ", iconHref: "/community" },
  { match: under("/setup/admin"), title: "最初の運営者を登録", parent: "設定", iconHref: "/settings" },
  { match: under("/community/review"), title: "認証審査", parent: "コミュニティ", iconHref: "/community" },
  { match: under("/community"), title: "コミュニティ", iconHref: "/community" },
  { match: under("/bbs"), title: "スレッド", iconHref: "/bbs" },
  { match: under("/threads"), title: "スレッド", iconHref: "/bbs", sectionHref: "/bbs" },
  { match: under("/music/studio"), title: "音楽を公開", parent: "音楽", iconHref: "/music" },
  { match: under("/music/library"), title: "ライブラリ", parent: "音楽", iconHref: "/music" },
  { match: under("/music/history"), title: "再生履歴", parent: "音楽", iconHref: "/music" },
  { match: under("/music/artists"), title: "アーティスト", parent: "音楽", iconHref: "/music" },
  { match: under("/music/albums"), title: "アルバム", parent: "音楽", iconHref: "/music" },
  { match: under("/music"), title: "音楽", iconHref: "/music" },
  { match: under("/world"), title: "3Dワールド", iconHref: "/services" },
  { match: under("/videos"), title: "動画", iconHref: "/videos" },
  { match: under("/search"), title: "検索", iconHref: "/search" },
  { match: under("/ai"), title: "AI", iconHref: "/ai" },
  { match: under("/compute"), title: "Compute", iconHref: "/compute" },
  { match: under("/node"), title: "パーソナルノード", iconHref: "/node" },
  { match: under("/p2p"), title: "ファイル転送", parent: "パーソナルノード", iconHref: "/node" },
  { match: under("/research"), title: "研究", iconHref: "/services" },
  { match: under("/classes"), title: "学び", iconHref: "/services" },
  { match: under("/events"), title: "イベント", iconHref: "/services" },
  { match: under("/travel"), title: "旅行", iconHref: "/services" },
  { match: under("/local-services"), title: "地域サービス", iconHref: "/services" },
  { match: under("/intent"), title: "依頼", iconHref: "/services" },
  { match: under("/wallet/pay"), title: "支払い", parent: "アカウント", iconHref: "/account" },
  { match: under("/wallet/tax"), title: "税務", parent: "アカウント", iconHref: "/account" },
  { match: under("/wallet"), title: "支払いと売上", parent: "アカウント", iconHref: "/account" },
  { match: under("/account/identity"), title: "本人情報", parent: "アカウント", iconHref: "/account" },
  { match: under("/account/payment"), title: "支払い設定", parent: "アカウント", iconHref: "/account" },
  { match: under("/account/transactions"), title: "取引履歴", parent: "アカウント", iconHref: "/account" },
  { match: under("/account"), title: "アカウント", iconHref: "/account" },
  { match: under("/settings"), title: "設定", iconHref: "/settings" },
  { match: under("/lists"), title: "リスト", iconHref: "/lists" },
  { match: under("/bookmarks"), title: "保存済み", iconHref: "/bookmarks" },
  { match: under("/ranking"), title: "トレンド", iconHref: "/ranking" },
  { match: under("/market/tickets/check-in"), title: "チケット受付", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/tickets/sell"), title: "チケットを出品", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/orders"), title: "注文", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/purchased"), title: "購入済み", parent: "マーケット", iconHref: "/market/purchased" },
  { match: under("/market/cart"), title: "カート", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/search"), title: "マーケット検索", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/products/sell"), title: "商品を出品", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/products/search"), title: "商品を検索", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/products"), title: "商品", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/digital/sell"), title: "デジタル商品を出品", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/digital"), title: "デジタル商品", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/wallet/invite"), title: "販売チーム", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/sell"), title: "出品する", parent: "マーケット", iconHref: "/market" },
  { match: under("/market/tickets"), title: "チケット", parent: "マーケット", iconHref: "/market" },
  { match: under("/market"), title: "マーケット", iconHref: "/market" },
  { match: under("/store"), title: "マーケット", iconHref: "/market" },
  { match: under("/shopping"), title: "ショッピング", iconHref: "/shopping" },
  { match: under("/work"), title: "仕事", iconHref: "/work" },
  { match: under("/jobs"), title: "求人", iconHref: "/jobs" },
  { match: under("/advertising/dashboard"), title: "広告管理", parent: "広告", iconHref: "/advertising" },
  { match: under("/advertising/library"), title: "広告ライブラリ", parent: "広告", iconHref: "/advertising" },
  { match: under("/advertising"), title: "広告", iconHref: "/advertising" },
  { match: under("/ads"), title: "広告", iconHref: "/advertising" },
  { match: under("/developers"), title: "開発者", iconHref: "/services" },
  { match: under("/services"), title: "サービス", iconHref: "/services" },
  { match: under("/games"), title: "ゲーム", iconHref: "/services" },
  { match: under("/token"), title: "トークン", iconHref: "/token" },
  { match: under("/earnings"), title: "収益", iconHref: "/wallet" },
  { match: under("/creator"), title: "クリエイター", iconHref: "/account" },
  { match: under("/admin"), title: "管理", iconHref: "/settings" },
  { match: under("/privacy"), title: "プライバシー", iconHref: "/about" },
  { match: under("/terms"), title: "利用規約", iconHref: "/about" },
  { match: under("/legal"), title: "サービス条件", iconHref: "/about" },
  { match: under("/about"), title: "Hubについて", iconHref: "/about" },
  { match: under("/copyright"), title: "著作権", iconHref: "/about" },
  { match: under("/appeal"), title: "異議申し立て", iconHref: "/about" },
  { match: under("/auth"), title: "ログイン", iconHref: "/account" },
  { match: under("/onboarding"), title: "初期設定", iconHref: "/account" },
  { match: exact("/requests"), title: "仕事", iconHref: "/work" },
  { match: exact("/social"), title: "ホーム", iconHref: "/" },
  { match: exact("/timeline"), title: "ホーム", iconHref: "/" },
  { match: under("/feed/external"), title: "外部フィード", parent: "フィード", iconHref: "/feed" },
  { match: exact("/feed"), title: "フィード", iconHref: "/feed" },
  { match: exact("/"), title: "フィード", iconHref: "/" },
];

/*
 * A section is only worth linking to if something answers there. Four of them
 * name a family of pages with no index of their own — /posts, /threads,
 * /profile, /market/sellers — and a link to those is a 404. The generated
 * registry already lists every route, so the question is answered from the
 * same source the inventory check keeps honest. Redirects count: they answer
 * and land somewhere real, and /hubpedia is one of them because it forwards
 * to itself with parameters.
 */
const RENDERED_ROUTES = new Set<string>(HUB_PAGE_UI_REGISTRY.map((page) => page.route));

export function hubSectionIsBrowsable(section: string): boolean {
  return RENDERED_ROUTES.has(section);
}
export function resolveHubPageTitle(pathname: string): HubPageTitle {
  const normalized = pathname.split("?")[0]?.split("#")[0] || "/";

  const match = RULES.find((rule) => rule.match(normalized));
  if (match) {
    return {
      title: match.title,
      parent: match.parent,
      iconHref: match.iconHref,
      section: match.sectionHref ?? match.match.section,
    };
  }
  return { title: "Hub", iconHref: "/", section: "/" };
}
