import { HUB_PAGE_UI_REGISTRY } from "@/lib/generated-page-ui-registry";

/*
 * 二種類ある画面は新しいほう（v2）を出す（2026-09-04、旦那様の決定）。
 *
 * 対応する道と v2 に無い道は、生成された registry の現在の内容から決める。
 * 件数をここに書かず、route registry と下の例外だけを境界の正本にする。
 *
 * **ここに "use client" を書かない。** 経路の判断は proxy と Cloudflare の
 * worker の両方が呼ぶ。
 */

/* 経路の一覧から作る。手で並べると必ず腐る。 */
const V2_ROUTES = new Set<string>(
  HUB_PAGE_UI_REGISTRY
    .map((page) => page.route)
    .filter((route) => route === "/v2" || route.startsWith("/v2/"))
    /* /v2/[...missing] は存在しない道を 404 にするだけの受け皿で、画面ではない。v1 の道の転送先に数えない。 */
    .filter((route) => route !== "/v2/[...missing]"),
);

/* 動く区切りを含む v2 の道。/profile/jkamma は /v2/profile/[handle] に当たる。 */
const V2_SHAPES = [...V2_ROUTES].filter((route) => route.includes("[")).map((route) => route.split("/"));

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

function matchesRouteShape(shape: string[], parts: string[]): boolean {
  const tail = shape.at(-1) ?? "";
  const optionalCatchAll =
    tail.startsWith("[[...") && tail.endsWith("]]");
  const catchAll = optionalCatchAll || (tail.startsWith("[...") && tail.endsWith("]"));
  const prefix = catchAll ? shape.slice(0, -1) : shape;
  const minimumParts = prefix.length + (catchAll && !optionalCatchAll ? 1 : 0);

  if (parts.length < minimumParts || (!catchAll && parts.length !== shape.length)) return false;
  return prefix.every((segment, index) => isDynamicSegment(segment) || segment === parts[index]);
}

/*
 * v2 へ渡さない道（2026-09-04）。
 *
 * v2 の画面が**わざと**既存へ渡している行き先。v2 に同じ節が無いので、
 * ここを転送すると行き先そのものが消える。lib/v2-link-boundary.test.ts の
 * 許可の一覧と同じもので、あちらは「なぜ渡すのか」を1件ずつ書いてある。
 *
 * 増やすときは、その画面を開いて v2 に無いものを確かめてから。
 */
export const V2_ENTRY_EXCEPTIONS: readonly string[] = [];

/*
 * 転送しかしない道（2026-09-07）。
 *
 * /profile/me は既存が本人の handle へ送るだけの道。形だけ見ると
 * /v2/profile/[handle] に当たり、「me」という人の画面を開いてしまう。
 * 既存に転送させてから、その先（/profile/<handle>）を v2 へ渡す。
 * 上の例外とは別物——v2 の画面が既存へ出ている先ではないので、
 * 境界の許しの一覧とは照らさない。
 */
const V2_ENTRY_REDIRECT_ONLY = ["/profile/me"] as const;

/*
 * 例外の中でも渡すもの（2026-09-04）。
 *
 * 例外は木ごと止める。かつて /hubpedia を止めながら論文だけ通した。
 * 2026-09-07 に Hubpedia もプロフィールも木ごと v2 へ渡したので今は空。
 * 例外を細かく刻むより、渡すものを1件ずつ挙げるほうが読めるので仕組みは残す。
 */
const V2_ENTRY_ALLOWANCES: readonly string[] = [];

function isException(pathname: string): boolean {
  if (V2_ENTRY_ALLOWANCES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  if (V2_ENTRY_REDIRECT_ONLY.some((path) => pathname === path)) return true;
  return V2_ENTRY_EXCEPTIONS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/*
 * この道に v2 の画面が在るか。在れば渡す先を返す。
 * 無ければ null——既存の画面のまま。行けないより、v1 で開くほうがいい。
 */
export function v2EntryFor(pathname: string): string | null {
  if (pathname === "/v2" || pathname.startsWith("/v2/")) return null;
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) return null;
  if (isException(pathname)) return null;
  const trimmed = pathname === "/" ? "" : pathname.replace(/\/$/, "");
  const candidate = trimmed === "" ? "/v2" : `/v2${trimmed}`;
  if (V2_ROUTES.has(candidate)) return candidate;
  const parts = candidate.split("/");
  for (const shape of V2_SHAPES) {
    if (matchesRouteShape(shape, parts)) return candidate;
  }
  return null;
}
