/*
 * v2 の画面が**リンクで辿り着けるか**を数える（2026-09-04）。
 *
 * 経路が在って200を返しても、どこからも指されていなければ誰も開かない。
 * それは機能が無いのとほぼ同じで、しかも画面ごとの検査は全部緑になる
 * （2026-08 に、開けない管理画面が長く壊れたままだった前例がある）。
 *
 * sweep-screens.mjs は「その画面は崩れていないか」、walk-hub-flows.mjs は
 * 「その旅は繋がっているか」、これは**「その画面へ行けるか」**を聞く。
 *
 * やり方: /v2 から内部リンクを辿って（既定で深さ2）集めた行き先を、
 * app/v2 から見つけた経路の一覧と突き合わせる。動く部分（[id]）を含む経路は、
 * 同じ形のリンクが1本でもあれば辿り着けたと数える。
 *
 * **見えないもの**: 読み取るのはサーバーが返した HTML だけなので、押してから
 * 描かれるリンク（クライアントで組み立てる一覧、開いてから出る帯）は数えない。
 * 例: /v2/services のサービスの札は、読み込み後に描かれるので出てこない。
 * ここに挙がった経路は「指されていない疑い」であって、確定ではない。1本ずつ見る。
 *
 * 使い方: node scripts/check-v2-reachability.mjs [--base http://localhost:3111] [--depth 2]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv;
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const BASE = arg("--base", process.env.HUB_FLOW_BASE_URL ?? "http://localhost:3111");
const DEPTH = Number(arg("--depth", "2"));

/* app/v2 から経路を見つける。page.tsx がある入れ子だけが経路。 */
function routesUnder(directory, prefix) {
  const routes = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (!statSync(path).isDirectory()) {
      if (name === "page.tsx") routes.push(prefix || "/v2");
      continue;
    }
    /* (group) は URL に出ない。@slot と _private は経路ではない。 */
    if (name.startsWith("_") || name.startsWith("@")) continue;
    const segment = name.startsWith("(") && name.endsWith(")") ? "" : `/${name}`;
    routes.push(...routesUnder(path, prefix + segment));
  }
  return routes;
}

/* /v2/profile/[handle] → ^/v2/profile/[^/]+$ */
function routePattern(route) {
  const source = route
    .split("/")
    .map((segment) => (segment.startsWith("[") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}$`);
}

const HREF = /href="(\/v2[^"#?]*)/g;

/*
 * 取れなかった頁は**数に入れない**（2026-09-04）。
 * もとは失敗を「リンク0本」として返していたので、サーバーが詰まった隙に走ると
 * 左列に在る /v2/search や /v2/settings まで「入口が無い」に化けた。
 * 取れなかったことは取れなかったと数え、最後にそう言う。
 */
const unread = [];

/*
 * 1度だけ待って読み直す（2026-09-04）。
 * 開発サーバーはメモリの閾値で自分を入れ直す。その瞬間に当たった1本のせいで
 * 走査ぜんぶが「当てにならない」になるのはもったいない。単独で叩けば200が返る
 * 頁が、走査の途中でだけ TypeError になっていた。
 */
async function fetchOnce(path) {
  return fetch(BASE + path, {
    headers: { accept: "text/html", origin: BASE },
    signal: AbortSignal.timeout(60_000),
  });
}

async function linksOn(path) {
  let response;
  try {
    response = await fetchOnce(path);
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    try {
      response = await fetchOnce(path);
    } catch (error) {
      unread.push(`${path}（${error.name}、2回とも）`);
      return [];
    }
  }
  if (!response.ok) {
    unread.push(`${path}（${response.status}）`);
    return [];
  }
  const html = await response.text();
  const found = new Set();
  for (const match of html.matchAll(HREF)) found.add(match[1].replace(/\/$/, "") || "/v2");
  return [...found];
}

const routes = [...new Set(routesUnder(join(process.cwd(), "app", "v2"), "/v2"))].sort();

/*
 * サービス一覧（/v2/services）の札は読み込み後に描かれるので、HTML を読むだけでは
 * 辿れない。目録は lib/hub-services.ts にあるので、そこから行き先を読み、
 * 一覧そのものへ行けるときに限って「一覧から行ける」と数える。
 * 一覧へ行けないなら、そこに載っていても誰も辿り着けない。
 */
function servicesCatalogueRoutes() {
  try {
    const source = readFileSync(join(process.cwd(), "lib", "hub-services.ts"), "utf8");
    return [...source.matchAll(/href:\s*"([^"]+)"/g)]
      .map((match) => match[1].split(/[#?]/)[0])
      .filter((href) => href.startsWith("/"))
      .map((href) => (href === "/feed" ? "/v2" : `/v2${href.replace(/\/$/, "")}`));
  } catch {
    return [];
  }
}
const seen = new Set(["/v2"]);
const linked = new Set();
let frontier = ["/v2"];

for (let depth = 0; depth <= DEPTH; depth += 1) {
  const next = [];
  for (const path of frontier) {
    let hrefs = [];
    try {
      hrefs = await linksOn(path);
    } catch {
      /* 開けない経路は辿れないだけ。走査そのものは続ける */
    }
    for (const href of hrefs) {
      linked.add(href);
      if (!seen.has(href)) {
        seen.add(href);
        next.push(href);
      }
    }
  }
  frontier = next;
  if (!frontier.length) break;
}

/*
 * サービス一覧から行ける画面も開いてみる（2026-09-04）。
 *
 * 札は読み込み後に描かれるので、辿るだけではその先の頁を取りに行かない。
 * 一覧そのものへ行けるなら、そこに載っている画面は開ける。開けるなら、
 * その中に書かれたリンクも人は押せる。/v2/research がこれで、一覧に
 * 研究が並んでいても /v2/research/[projectId] が「入口が無い」に残っていた。
 */
if ([...linked].some((href) => href === "/v2/services")) {
  for (const route of servicesCatalogueRoutes()) {
    if (seen.has(route)) continue;
    seen.add(route);
    let hrefs = [];
    try {
      hrefs = await linksOn(route);
    } catch {
      /* 開けない経路は辿れないだけ。 */
    }
    for (const href of hrefs) linked.add(href);
  }
}

/*
 * 辿れた画面の**中身に書かれた**リンク（2026-09-04）。
 *
 * HTTP で読めるのはサーバーが返した形だけ。押してから描かれる一覧（作品の一覧、
 * 動画の一覧、商品の一覧）のリンクは出てこない。そのため /v2/games から実際に
 * リンクされている /v2/games/[gameSlug] まで「入口が無い」に数えていた。
 *
 * 一覧を作っている元は app/v2 と components の中に在る。**辿り着けた画面の元**を
 * 読んで、そこに書かれた行き先も到達として数える。辿り着けていない画面の中身は
 * 読まない——そこから先は、そもそも誰も来られないので。
 */
function sourceLinksOf(route) {
  const directory = join(process.cwd(), "app", route === "/v2" ? "v2" : route.replace("/v2/", "v2/"));
  const files = [];
  const collect = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      /* 子の画面は別に数える。ここはこの画面の直下の file だけ。 */
      if (statSync(path).isDirectory()) continue;
      if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  collect(directory);
  /*
   * 画面が読み込む部品も読む（2026-09-04）。
   *
   * 入口が画面の file に無く、共有の部品の中にあることがある。/v2/world は
   * WorldServers を描き、その中に「自分のサーバを建てる」がある。画面の file
   * だけを見ていたので /v2/world/servers を「入口が無い」に数えていた。
   */
  for (const file of [...files]) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(/from\s+["']@\/components\/([\w./-]+)["']/g)) {
      for (const extension of [".tsx", ".ts"]) {
        const path = join(process.cwd(), "components", `${match[1]}${extension}`);
        try {
          statSync(path);
          if (!files.includes(path)) files.push(path);
          break;
        } catch {
          /* 別の拡張子を試す。 */
        }
      }
    }
  }
  const found = new Set();
  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(/["'`](\/v2\/[^"'`\n$]*)/g)) {
      found.add(match[1].replace(/\/$/, ""));
    }
    /* href={`/v2/games/${...}`} の形は、頭までを1区切りの型として拾う。 */
    for (const match of source.matchAll(/["'`](\/v2\/[^"'`\n]*?)\$\{/g)) {
      found.add(`${match[1].replace(/\/$/, "")}/*`);
    }
    /*
     * `const base = v2 ? "/v2/world" : "/world"` を置いてから `${base}/servers`
     * と書く形。名前に入れた頭と、その名前を使った続きを繋いで1本の行き先にする。
     */
    for (const declaration of source.matchAll(/(?:const|let)\s+(\w+)\s*=[^;\n]*?["'`](\/v2\/[^"'`\n$]*)["'`]/g)) {
      const [, name, head] = declaration;
      const start = head.replace(/\/$/, "");
      found.add(start);
      for (const use of source.matchAll(new RegExp(`\\\$\\{${name}\\}(/[\\w-]+)`, "g"))) {
        found.add(`${start}${use[1]}`);
      }
    }
  }
  return [...found];
}

const catalogue = new Set(servicesCatalogueRoutes());
const servicesReachable = [...linked].some((href) => href === "/v2/services");

const reached = [];
const viaServices = [];
const viaSource = [];
const orphans = [];
const forwarding = [];

/*
 * 辿り着けた画面の元に書かれた行き先。
 * **一覧から行ける画面の中身も読む**（2026-09-04）。サービス一覧経由でしか
 * 行けない /v2/games の中身を読まないと、そこから実際にリンクされている
 * /v2/games/[gameSlug] が「入口が無い」に残ってしまう。
 */
const fromSource = new Set();
for (const route of routes) {
  const pattern = routePattern(route);
  const openable = [...linked].some((href) => pattern.test(href))
    || (servicesReachable && catalogue.has(route));
  if (!openable) continue;
  for (const href of sourceLinksOf(route)) fromSource.add(href);
}

/* /v2/games/* は /v2/games/[gameSlug] に当たる。 */
const sourceCovers = (route) => [...fromSource].some((href) => {
  if (href.endsWith("/*")) {
    const head = href.slice(0, -2);
    return route.startsWith(`${head}/`) && route.slice(head.length + 1).startsWith("[");
  }
  return routePattern(route).test(href);
});

/*
 * 外から開く画面（2026-09-04）。
 *
 * 招待の URL と入場確認の QR は、Hub の中の並びには出さない。人に渡す
 * リンクとして作られ、受け取った人がそれを開く。中に入口が無いのが正しい。
 *
 * ただし「入口が無い」と「入口を作る所が壊れた」は見分けが付かないので、
 * **URL を作っている所が今も在ること**を確かめる。作る所が消えたら、
 * その画面は本当に誰も開けない——そのときは欠陥として出す。
 */
const OUTSIDE_ENTRANCES = [
  { route: "/v2/community/invite/[code]", file: "components/community-operations-center.tsx", marker: "/community/invite/" },
  { route: "/v2/market/tickets/check-in", file: "components/market-ticket-system.tsx", marker: "${basePath}/check-in" },
];

/*
 * 転送だけの経路（2026-09-04）。
 *
 * 中身が無く、開くとすぐ別の画面へ渡す。見るものが無いので、そこへ入る
 * 入口も要らない。URL を持っている人が迷わないために残してあるだけ。
 * 数に入れると「入口が無い」が永久に減らない。
 */
function redirectOnly(route) {
  const directory = route === "/v2" ? "v2" : route.replace("/v2/", "v2/");
  let source;
  try {
    source = readFileSync(join(process.cwd(), "app", directory, "page.tsx"), "utf8");
  } catch {
    return false;
  }
  return /\bredirect\(/.test(source) && !/return\s*\(/.test(source);
}

const outside = [];
const brokenOutside = [];
for (const entry of OUTSIDE_ENTRANCES) {
  let source = "";
  try {
    source = readFileSync(join(process.cwd(), entry.file), "utf8");
  } catch {
    source = "";
  }
  if (source.includes(entry.marker)) outside.push(entry);
  else brokenOutside.push(entry);
}
const outsideRoutes = new Set(outside.map((entry) => entry.route));

for (const route of routes) {
  const pattern = routePattern(route);
  if ([...linked].some((href) => pattern.test(href))) reached.push(route);
  else if (servicesReachable && catalogue.has(route)) viaServices.push(route);
  else if (sourceCovers(route)) viaSource.push(route);
  else if (outsideRoutes.has(route)) continue;
  else if (redirectOnly(route)) forwarding.push(route);
  else orphans.push(route);
}

console.log(`/v2 から深さ${DEPTH}で辿ったリンク ${linked.size} 本。`);
if (unread.length) {
  console.log(`**${unread.length} 本の頁を読めなかった。この回の「入口の無い経路」は当てにならない。**`);
  for (const item of unread.slice(0, 8)) console.log(`  読めず: ${item}`);
  console.log("  サーバーが落ち着いてから測り直す。");
}
console.log(`経路 ${routes.length} 本のうち、リンクで辿り着けた ${reached.length} 本。`);
if (viaSource.length) {
  console.log(`辿り着けた画面の中から行ける ${viaSource.length} 本。一覧が後から描かれるので、HTTPでは辿れないだけ。`);
}
if (viaServices.length) {
  console.log(`サービス一覧（/v2/services）から行ける ${viaServices.length} 本。一覧は札が後から描かれるので、辿れないだけ。`);
}
if (forwarding.length) {
  console.log(`転送だけの経路 ${forwarding.length} 本。中身が無いので入口も要らない。`);
}
if (outside.length) {
  console.log(`人に渡すリンクから開く ${outside.length} 本。中に入口が無いのが正しい（作る所は在る）。`);
}
for (const entry of brokenOutside) {
  console.log(`**${entry.route} を開く URL を作る所が無い。** ${entry.file} に ${entry.marker} が見当たらない。誰もこの画面へ行けない。`);
}
if (!servicesReachable) {
  console.log("**サービス一覧（/v2/services）自体へ行けない。** ここが塞がると、左列に無い画面がまとめて開けなくなる。");
}
if (orphans.length) {
  console.log(`\nどこからも指されていない経路 ${orphans.length} 本:`);
  for (const route of orphans) console.log(`  ${route}`);
  console.log("\n深さを増やすと減ることがある（--depth 3）。それでも残るなら、入口が無い。");
}
process.exitCode = 0;
