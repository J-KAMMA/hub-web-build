/*
 * ページ内検索を「中左列のヘッダー行」に置く面の一覧。
 *
 * **Hubには検索欄の置き場所が2つあり、どちらも正しい。** 消して片方へ
 * 寄せようとすると壊れるので、境界をここに書いておく。
 *
 * 1. 本体列の最上段（components/tab-main-search-header.tsx）
 *    2026-08-30の4列規格。ページ固有の目録を中左列に持つ画面が使う。
 *    /feed /articles /hubpedia /bbs /market /videos /music /adult /community。
 *    この一覧には載せない。載せると同じ役割が二重になる。
 *
 * 2. 中左列のヘッダー行（この一覧 → components/shell-page-header.tsx）
 *    中左列を持たない2列の画面が使う。/work /jobs /events /classes
 *    /travel /local-services は MarketPageFrame を
 *    共有し、**横並びのタクソノミー**が navigation なので左列を持たない。
 *    /games も左列へ入れる目録が無い。
 *    ここへ中左列を足すと、横の分類と縦の分類が二重になる。
 *
 *    /community は 2026-08-31 に2へ入れるのをやめて1へ移した。目録が無い
 *    という前提が誤りで、「参加中のコミュニティ」と「カテゴリ」という縦の
 *    目録を実際には持っていた。本体へ押し込んだ結果、この一覧のヘッダー検索と
 *    画面内の検索が二重になり、ページ名が127pxまで潰れて折り返していた。
 *
 * /search は1でも2でもなく、自前のコンボボックスを持つ。候補リストが
 * ヘッダーを基準に配置されるため、高さ58px固定の標準行へ入れると切れる。
 * showSearchForm={false} で意図的にこの一覧へ委ねている。
 *
 * 置き場所を変えるときは、対象ページが中左列を持つかを先に測る。
 * .shell-page-search は共有の検索欄ルール（width:100%）と同じ詳細度で
 * width を奪い合うので、max-width での上限が外れると本体列をはみ出す。
 */
export type HubPageSearch = {
  action: string;
  ariaLabel: string;
  placeholder: string;
};

type PageSearchRule = HubPageSearch & {
  matches: (path: string) => boolean;
};

const exact = (expected: string) => (path: string) => path === expected;
const below = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}/`);

const PAGE_SEARCH_RULES: PageSearchRule[] = [
  { matches: exact("/"), action: "/search", ariaLabel: "Hubを検索", placeholder: "投稿・スレッド・人物を検索" },
  // /feed は本体列の最上段に TabMainSearchHeader を持つ（4列規格）。
  // ここへ戻すと中左列のヘッダー行にも出て、同じ役割が二重になる。
  { matches: exact("/search"), action: "/search", ariaLabel: "Hubを検索", placeholder: "Hubを検索" },
  { matches: below("/hubpedia"), action: "/hubpedia", ariaLabel: "Hubpediaを検索", placeholder: "記事名・読み・分野を検索" },
  { matches: below("/adult"), action: "/articles", ariaLabel: "記事を検索", placeholder: "記事名・タグを検索" },
  { matches: below("/bbs"), action: "/bbs", ariaLabel: "スレッドを検索", placeholder: "タイトル・カテゴリ・投稿内容を検索" },
  { matches: below("/threads"), action: "/bbs", ariaLabel: "スレッドを検索", placeholder: "スレッドを検索" },
  { matches: exact("/games"), action: "/games", ariaLabel: "ゲームを検索", placeholder: "ゲーム名・略称を検索" },
  { matches: exact("/events"), action: "/events", ariaLabel: "イベントを検索", placeholder: "イベント名・地域を検索" },
  { matches: exact("/classes"), action: "/classes", ariaLabel: "講座を検索", placeholder: "講座・学びを検索" },
  { matches: exact("/work"), action: "/work", ariaLabel: "クラウドソーシングを検索", placeholder: "案件・スキルを検索" },
  { matches: exact("/jobs"), action: "/jobs", ariaLabel: "求人を検索", placeholder: "職種・企業・地域を検索" },
  { matches: exact("/travel"), action: "/travel", ariaLabel: "旅行情報を検索", placeholder: "地域・施設・体験を検索" },
  { matches: exact("/local-services"), action: "/local-services", ariaLabel: "地域サービスを検索", placeholder: "サービス・地域を検索" },
  { matches: below("/market/tickets"), action: "/market/tickets", ariaLabel: "チケットを検索", placeholder: "イベント・チケットを検索" },
  { matches: below("/market"), action: "/market/search", ariaLabel: "マーケットを検索", placeholder: "商品・サービスを検索" },
  { matches: below("/shopping/search"), action: "/shopping/search", ariaLabel: "商品を検索", placeholder: "商品名・カテゴリを検索" },
];

export function resolveHubPageSearch(currentPath: string): HubPageSearch | null {
  const path = currentPath.split("?", 1)[0] || "/";
  const rule = PAGE_SEARCH_RULES.find((candidate) => candidate.matches(path));
  if (!rule) return null;
  return { action: rule.action, ariaLabel: rule.ariaLabel, placeholder: rule.placeholder };
}
