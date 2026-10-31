import { HUB_PAGE_UI_REGISTRY } from "@/lib/generated-page-ui-registry";

/*
 * v2 の中から開いたときは v2 の画面へ渡す（2026-09-04）。
 *
 * `lib/hub-services.ts` は Hub の全サービスの目録で、行き先はすべて既存（v1）の道。
 * v2 の `/v2/services` はその目録をそのまま出していたので、押すと v2 の外へ出て、
 * 左列も右列も変わってしまっていた。
 *
 * 対応する v2 の道が**実在するときだけ**差し替える。手で並べた一覧は必ず腐るので、
 * 経路の一覧（scripts/generate-page-inventory.mjs が作る registry）から判断する。
 * 無ければ既存の道のまま。行けないより、v1 へ渡すほうがいい。
 */

/* registry の route は文字列の直和なので、素の文字列で引けるように広げる。 */
const V2_ROUTES = new Set<string>(
  HUB_PAGE_UI_REGISTRY
    .map((page) => page.route)
    .filter((route) => route === "/v2" || route.startsWith("/v2/")),
);

/*
 * 道の名前が同じにならないものだけ、ここに書く。
 * v2 のフィードは `/v2` そのもので、`/v2/feed` という画面は無い。
 * 機械的な差し替えでは v1 へ落ちるので、1件だけ名指しする。
 */
const RENAMED: Record<string, string> = { "/feed": "/v2" };

/* 経路の一覧に在る道すべて。動く区切りを含む形のままで持つ。 */
const ALL_ROUTES = new Set<string>(HUB_PAGE_UI_REGISTRY.map((page) => page.route));

/*
 * 動く区切りを持つ v2 の道（2026-09-04）。
 *
 * `/profile/jkamma` は一覧にそのままでは無い。在るのは `/v2/profile/[handle]`。
 * 字の数と literal の区切りが合えば、その画面が在ると見なす。
 */
const V2_SHAPES = [...V2_ROUTES]
  .filter((route) => route.includes("["))
  .map((route) => ({ route, parts: route.split("/") }));

function shapedV2Route(path: string): string | null {
  /*
   * **その道が v1 の画面としてそのまま在るなら、形で当てない。**
   * `/articles/new` は v1 の画面で、形だけ見ると `/v2/articles/[articleId]` に
   * 当たってしまう。「new」という記事の詳細が開いて壊れる（この罠は
   * lib/v2-link-boundary.test.ts にも書いてある）。
   */
  if (ALL_ROUTES.has(path)) return null;
  const parts = `/v2${path}`.split("/");
  for (const candidate of V2_SHAPES) {
    if (candidate.parts.length !== parts.length) continue;
    const fits = candidate.parts.every((segment, index) => segment.startsWith("[") || segment === parts[index]);
    if (fits) return `/v2${path}`;
  }
  return null;
}

export function v2ServiceHref(href: string | undefined): string | undefined {
  if (!href || !href.startsWith("/") || href.startsWith("/v2")) return href;
  if (RENAMED[href]) return RENAMED[href];
  /* #agent-access や ?tab= は行き先の一部。道の部分だけで探して、後ろは付け直す。 */
  const cut = href.search(/[#?]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? "" : href.slice(cut);
  const candidate = path === "/" ? "/v2" : `/v2${path.replace(/\/$/, "")}`;
  if (V2_ROUTES.has(candidate)) return `${candidate}${rest}`;
  const shaped = shapedV2Route(path.replace(/\/$/, ""));
  return shaped ? `${shaped}${rest}` : href;
}
