/*
 * 画面の幾何を一度に走査する。
 *
 * measure-screens.mjs は「設計が言う値」と「実際に描かれた値」を突き合わせる。
 * こちらは別の問いに答える。**枠からはみ出したもの、切れた文字、
 * 縮んだ枠に取り残された grid の軌道**を、経路ごとに数える。
 *
 * この形の欠陥は2026-08から2026-09にかけて10件以上見つかっており、
 * どれも「詳細度の高い規則が寸法だけ縮め、内側の軌道や padding が
 * 前の設計のまま残る」という同じ形をしていた。型検査もjsdomの検査も
 * 一つも捕まえられない。jsdom は配置を計算しないため。
 *
 * 判定は実測で行い、既に踏んだ罠を避ける:
 *   - 閉じた <details> の中身にも矩形があるので除外する
 *   - overflow-x: auto の帯の中は意図した横スクロールなので祖先8段まで遡って除外
 *   - 幅1〜2pxは読み上げ専用ラベル
 *   - 中左列は列の中で完結するので本体列の判定から外す
 *   - 毎回 innerWidth を読む。視野の指定は勝手に戻ることがある
 *
 * 使い方:
 *   node scripts/sweep-screens.mjs                     (localhost:3111、1440と1920)
 *   node scripts/sweep-screens.mjs --base <origin>     (VPSやstagingへ)
 *   node scripts/sweep-screens.mjs --width 1440        (1つの幅だけ)
 *   node scripts/sweep-screens.mjs --paths /bbs,/videos
 *   node scripts/sweep-screens.mjs --json out.json     (機械可読で残す)
 *
 * 欠陥が1件でもあれば終了コード1。無ければ0。
 */

import { chromium } from "playwright";
import { readdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const BASE = flag("--base", "http://localhost:3111").replace(/\/$/, "");
const WIDTHS = flag("--width", "") ? [Number(flag("--width", ""))] : [1440, 1920];
const HEIGHT = 900;

/*
 * 走る経路は app/ から自分で見つける。手で並べていたときは29本で、
 * 実際にある静的な経路は127本だった。書き足し忘れた画面は誰も測らない。
 *
 * ログインが要る画面も含む。開発用のセッション差し替え
 * (HUB_DEV_SESSION_PROFILE_ID、lib/server/hub-session.ts) が入っていれば開く。
 * 入っていない場合は未ログインの表示を測ることになるので、結果に viewer を出す。
 */
function discoverPaths() {
  const root = new URL("../app/", import.meta.url);
  const found = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        /* 動的な区画は例を別に持つ。api は画面ではない。 */
        if (entry.name.startsWith("[") || entry.name === "api") continue;
        /* (group) は経路に出ない。 */
        const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
        walk(new URL(`${entry.name}/`, directory), `${prefix}${segment}`);
      } else if (entry.name === "page.tsx") {
        found.push(prefix === "" ? "/" : prefix);
      }
    }
  };
  walk(root, "");
  return found.sort();
}

/*
 * 動的な経路の例。空の画面は欠陥を隠すので、中身のある実物を指す。
 * ここが404を返すようになったら、その行は「main-content 無し」で挙がる。
 */
const DYNAMIC_EXAMPLES = [
  "/threads/thread-104",
  "/community?community=fallout-4-jp",
  "/search?q=%E7%81%AF%E3%82%8A",
  "/market/search?q=%E6%9C%AC",
];

const DEFAULT_PATHS = [...discoverPaths(), ...DYNAMIC_EXAMPLES];

/*
 * Git Bash は先頭が / の引数をWindowsのパスへ化かす。--paths /bbs が
 * C:/Program Files/Git/bbs になって届く。化けた分を剥がし、先頭の / を補う。
 */
const normalizePath = (value) => {
  const stripped = value.replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/u, "/");
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
};

/*
 * --only <頭> で、その頭から始まる経路だけに絞る（2026-09-04）。
 * 全経路×2つの幅は20分を超え、自動で回す1周に収まらない。
 */
const ONLY = flag("--only", "") ? normalizePath(flag("--only", "")) : "";

const PATHS = (flag("--paths", "")
  ? flag("--paths", "").split(",").map((p) => normalizePath(p.trim())).filter((p) => p !== "/")
  : DEFAULT_PATHS
).filter((path) => !ONLY || path === ONLY || path.startsWith(`${ONLY}/`) || path.startsWith(`${ONLY}?`));

/*
 * --slice i/n で、経路を n 等分した i 番目だけを測る（2026-09-04）。
 * 自動で回すときは1周を短く保ちたいが、範囲を狭めたままだと残りが永久に測られない。
 * 周ごとに場所をずらせば、1周は短いまま何周かで全部を覆える。
 * 並びは経路名で決まるので、同じ i は毎回同じ組になる。
 */
const SLICE = flag("--slice", "");
const SLICED = SLICE
  ? (() => {
      const [index, total] = SLICE.split("/").map(Number);
      if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
        throw new Error("--slice は i/n の形で、0 <= i < n");
      }
      return PATHS.filter((_, at) => at % total === index);
    })()
  : PATHS;

/* ページの中で走らせる本体。ブラウザ側にそのまま渡す。 */
function inspect() {
  const leftColumn = document.querySelector("[data-hub-page-left-column]");
  /*
   * 本文の枠。既存のシェルは .main-content、v2 のシェルは .v2__main。
   * どちらも「はみ出したかどうかを判定する基準の枠」という同じ役割を持つ。
   */
  const main = document.querySelector(".main-content") ?? document.querySelector(".v2__main");
  if (!main) return { error: "本文の枠が無い（.main-content も .v2__main も）", innerWidth: window.innerWidth };

  const frame = main.getBoundingClientRect();
  const skip = (el) => (leftColumn && leftColumn.contains(el))
    || el.closest("details:not([open])")
    || el.getBoundingClientRect().width <= 2;

  const all = [...main.querySelectorAll("*")];

  /* 意図した横スクロールの帯の中かどうか。祖先8段まで見る。 */
  const insideScroller = (el) => {
    let parent = el.parentElement;
    for (let depth = 0; parent && depth < 8; depth += 1) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return true;
      /* 2026-09-03: ここでも depth を足していて、実際は4段しか見ていなかった。ボタンの中の svg の path（5段）が帯の外と数えられた。 */
      parent = parent.parentElement;
    }
    return false;
  };

  const describe = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`;

  const over = all.filter((el) => {
    if (skip(el)) return false;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 2 && rect.height > 0)) return false;
    if (!(rect.right > frame.right + 1 || rect.left < frame.left - 1)) return false;
    return !insideScroller(el);
  }).map((el) => {
    const rect = el.getBoundingClientRect();
    return { el: describe(el), left: Math.round(rect.left), right: Math.round(rect.right) };
  });

  /*
   * 切れ。ただし text-overflow: ellipsis が指定されている要素は、切ること
   * 自体が意図なので数えない。**半分未満しか見えていないときだけ**数える。
   * 線引きは「読める文字が残っているか」。60px未満では日本語で3〜4字しか
   * 出ず、何の名前かも分からない。
   *   - スレッドの要約 601px（必要1261px）… 一覧の抜粋。意図どおり
   *   - 商品カードの店名 113px（必要228px）… 密な並びの店名。意図どおり
   *   - コミュニティ名 44px（必要111px）… 3字。読めない。欠陥
   * 割合で切ると、長い文の抜粋が全部挙がって本物の欠陥が埋もれる。
   */
  const clipped = [];
  for (const el of all) {
    if (skip(el) || el.children.length || !(el.textContent || "").trim()) continue;
    if (!(el.clientWidth > 2 && el.scrollWidth > el.clientWidth + 1)) continue;
    const style = getComputedStyle(el);
    /*
     * 実際に隠しているものだけを切れと数える。overflow が visible なら
     * 文字は枠の外へそのまま描かれるので読める。読めないのは、その要素が
     * hidden/clip か、横スクロールの帯の中で見えなくなっている場合。
     * 帯の中で隣に重なる場合は over 側が拾う。
     * 2026-09-02: /videos の分類ボタン（95pxに対し97px必要、overflow: visible）を
     * 切れとして数えていた。2pxの余白の丸めで、読めなくなってはいない。
     */
    if (style.overflowX === "visible" && style.textOverflow !== "ellipsis") continue;
    const deliberate = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
    if (deliberate && el.clientWidth >= 60) continue;
    clipped.push({
      el: describe(el),
      text: (el.textContent || "").trim().slice(0, 20),
      have: el.clientWidth,
      need: el.scrollWidth,
      deliberate,
    });
  }

  /*
   * 縮んだ枠に取り残された軌道。grid の列指定の合計が枠より広いもの。
   * これが見つかったら、たいてい寸法だけを縮めた規則が上にいる。
   */
  const staleTracks = all.filter((el) => {
    if (skip(el)) return false;
    const style = getComputedStyle(el);
    if (!/grid/.test(style.display) || el.clientWidth <= 2) return false;
    const total = style.gridTemplateColumns.split(" ").reduce((sum, part) => sum + (Number.parseFloat(part) || 0), 0);
    return total > el.clientWidth + 2;
  }).map((el) => ({
    el: describe(el),
    width: el.clientWidth,
    columns: getComputedStyle(el).gridTemplateColumns,
  }));

  return {
    innerWidth: window.innerWidth,
    hidden: document.hidden,
    heading: (document.querySelector("h1") || {}).textContent || null,
    viewer: !/ログインして|Sign in with Google/.test(document.body.innerText.slice(0, 800)),
    main: Math.round(frame.width),
    over,
    clipped,
    staleTracks,
  };
}

async function run() {
  const browser = await chromium.launch();
  const results = [];
  let defects = 0;
  let unreachable = 0;

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: HEIGHT } });
    for (const path of SLICED) {
      /*
       * 開発サーバーは初回のコンパイル中に接続を切ることがある（ERR_ABORTED）。
       * 一度だけ入れ直す。ここで諦めると、直っている画面を欠陥として数える。
       */
      let measured;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          try {
            await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
          } catch (error) {
            /*
             * 転送のある画面は goto が「別の遷移に割り込まれた」で失敗する。
             * 画面自体は転送先で普通に出ているので、失敗として数えてはいけない。
             * 2026-09-02、/account と /admin/* の20本以上がこれで「測れていない」
             * 扱いになっていた。転送先を測り、行き先を results に残す。
             */
            if (!/interrupted by another navigation/u.test(String(error))) throw error;
          }
          await page.waitForSelector(".main-content, .v2__main", { timeout: 25000 }).catch(() => undefined);
          /* 遅れて入る絵と行を待つ。読み込み中の絵は証拠にならない。 */
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
          measured = await page.evaluate(inspect);
          const landed = new URL(page.url()).pathname;
          /*
           * 転送を挟むと、枠が出来る前に測ってしまうことがある（2026-09-04）。
           * /market/games は /market/search へ転送するだけの経路で、転送先には
           * 枠が在るのに「本文の枠が無い」と出た。**1度だけ待ち直す。**
           * 枠が無いことと、枠が出来る前に見たことを混同しない。
           */
          if (measured.error && landed !== path.split("?")[0]) {
            await page.waitForSelector(".main-content, .v2__main", { timeout: 25000 }).catch(() => undefined);
            await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
            measured = await page.evaluate(inspect);
          }
          if (landed !== path.split("?")[0]) measured.landed = landed;
          break;
        } catch (error) {
          measured = { error: String(error).split("\n")[0].slice(0, 120) };
        }
      }
      const count = (measured.over?.length ?? 0) + (measured.clipped?.length ?? 0) + (measured.staleTracks?.length ?? 0);
      defects += count;
      /*
       * 開けなかった経路は「欠陥0」ではない。測れていないだけで、
       * 中がどうなっているか誰も知らない。別に数えて終了コードにも出す。
       */
      if (measured.error) unreachable += 1;
      results.push({ width, path, ...measured });

      const mark = measured.error ? "!" : count === 0 ? "." : "x";
      const detail = measured.error
        ? measured.error
        : `本体${measured.main} はみ出し${measured.over.length} 切れ${measured.clipped.length} 軌道${measured.staleTracks.length}${measured.landed ? ` → ${measured.landed}` : ""}`;
      console.log(`${mark} ${String(width).padEnd(5)} ${path.padEnd(38)} ${detail}`);
      if (measured.innerWidth && measured.innerWidth !== width) {
        console.log(`  視野が ${measured.innerWidth} に戻っている。この行の数字は信用しない`);
      }
      for (const item of (measured.clipped ?? []).slice(0, 3)) {
        console.log(`    切れ: ${item.text} (${item.have}px、必要 ${item.need}px) ${item.el}`);
      }
      for (const item of (measured.over ?? []).slice(0, 3)) {
        console.log(`    はみ出し: ${item.el} ${item.left}〜${item.right}`);
      }
      for (const item of (measured.staleTracks ?? []).slice(0, 2)) {
        console.log(`    軌道: ${item.el} 枠${item.width}px に ${item.columns}`);
      }
    }
    await page.close();
  }

  await browser.close();

  const outPath = flag("--json", "");
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\n${results.length}件の結果を ${outPath} に書きました`);
  }

  console.log(`\n${results.length}行を測った。欠陥 ${defects} 件、開けなかった経路 ${unreachable} 本。`);
  if (defects) console.log("上の x の行を、当たっている規則まで辿ること。");
  if (unreachable) console.log("上の ! の行は測れていない。開発サーバーが生きているかを先に確かめる。");
  process.exit(defects === 0 && unreachable === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
