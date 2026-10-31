/*
 * Measure what the browser actually paints.
 *
 * The suite has three thousand tests and every one of them was green while
 * every post body on the platform rendered in the link colour, unread
 * notifications were a solid block of accent blue, and a received message
 * bubble was painted the same value as the page behind it. None of that is
 * visible to jsdom, which computes no layout and paints nothing, and none of
 * it is visible to a test that greps a stylesheet for a string: the string
 * was there, and a later stylesheet overruled it.
 *
 * So this script asks the only authority there is. It drives a real browser
 * against a running server, reads the computed style of the elements a
 * reader actually looks at, and compares them to what the design says they
 * should be. It is deliberately small: a handful of screens, and for each
 * one the few values that carry the design — what colour the body copy is,
 * whether the current place is marked, whether a control is where the hand
 * expects it.
 *
 * Usage:
 *   node scripts/measure-screens.mjs                  (against localhost:3111)
 *   node scripts/measure-screens.mjs --base <origin>  (against staging)
 *
 * It exits non-zero when a measurement disagrees with the design, and prints
 * the measured value beside the expected one, because a number you can read
 * is what turns "the design looks wrong" into a line to change.
 */

import { chromium } from "playwright";

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : "http://localhost:3111";
const WIDTH = 1720;
const HEIGHT = 900;

/* Resolved from the theme at run time; a token is not an answer by itself. */
const token = (name) =>
  `getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`;

/*
 * Each check names an element, a property, and the value the design asks
 * for. `expect` may be a literal, or a function of the resolved tokens, so
 * a check states the design's intent ("the body copy is the text role")
 * rather than a hex value that drifts with the palette.
 */
const SCREENS = [
  {
    path: "/",
    name: "フィード",
    checks: [
      { sel: ".home-feed__stream .tweet__text", prop: "color", expect: (t) => t.text,
        why: "本文は文字色。リンク色で描かれていた" },
      { sel: ".home-feed__stream .tweet__handle", prop: "color", expect: (t) => t.muted,
        why: "@名はミュート。本文と同色だった" },
      { sel: ".home-feed__stream .tweet__text", prop: "fontSize", expect: "16px",
        why: "紙面の本文は16px" },
      { sel: ".home-feed__stream .tweet__text", prop: "lineHeight", expect: "28.8px",
        why: "行間1.8" },
      { sel: ".home-feed__stream .tweet", prop: "backgroundColor", expect: "rgba(0, 0, 0, 0)",
        why: "カードは地色を持たない" },
      { sel: ".home-feed__stream .tweet", prop: "borderRadius", expect: "0px",
        why: "紙面に角丸はない" },
      { sel: ".feed-directory", prop: "position", expect: "sticky",
        why: "ページ左列は貼り付く" },
    ],
  },
  {
    path: "/bbs",
    name: "掲示板",
    checks: [
      { sel: "[data-hub-page-left-column]", prop: "position", expect: "sticky",
        why: "ページ左列があること" },
    ],
  },
  {
    path: "/search?q=%E7%81%AF%E3%82%8A",
    name: "検索",
    checks: [
      { sel: ".search-directory .tl-tab--active", prop: "color", expect: (t) => t.text,
        why: "現在地は文字色で示さない。アクセント文字で描かれていた" },
      { sel: ".search-page input[type=\"search\"]", prop: "height", expect: (t) => t.searchHeight,
        why: "検索欄は正典の寸法。40pxの丸ピルに漂流していた" },
      { sel: ".search-page input[type=\"search\"]", prop: "borderRadius", expect: (t) => t.searchRadius,
        why: "同上" },
    ],
  },
  {
    path: "/hubpedia",
    name: "Hubpedia",
    checks: [
      { sel: ".hubpedia__articles article", prop: "backgroundColor", expect: (t) => t.encyclopediaPanel,
        why: "百科は自分の紙面色を持つ" },
    ],
  },
];

/* Layout facts that hold on every screen, checked once on the feed. */
const LAYOUT = {
  path: "/",
  name: "4領域の骨格",
  measure: `(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width) }; };
    const nav = box(".sidebar"), dir = box("[data-hub-page-left-column]"), body = box(".home-feed"), rail = box(".shell__right");
    if (!nav || !dir || !body) return { error: "column missing", nav, dir, body };
    return {
      navToDirectory: dir.x - (nav.x + nav.w),
      directoryToBody: body.x - (dir.x + dir.w),
      bodyToRail: rail ? rail.x - (body.x + body.w) : null,
      navOverflows: (() => { const n = document.querySelector(".sidebar__nav"); if (!n) return null; const last = [...n.children].at(-1); return last ? Math.round(last.getBoundingClientRect().bottom) > window.innerHeight : null; })(),
    };
  })()`,
  /* Columns stand against each other; a gap between them is dead ground. */
  assert: (m) => {
    const problems = [];
    if (m.error) problems.push(`列が見つからない: ${m.error}`);
    if (m.navToDirectory !== 0) problems.push(`ナビとページ左列の隙間 ${m.navToDirectory}px (期待 0)`);
    if (m.directoryToBody !== 0) problems.push(`ページ左列と本体の隙間 ${m.directoryToBody}px (期待 0)`);
    if (m.bodyToRail !== null && m.bodyToRail !== 0) problems.push(`本体と右列の隙間 ${m.bodyToRail}px (期待 0)`);
    return problems;
  },
};

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const failures = [];
  let checked = 0;

  /* The theme is a device preference; the measurements assume the dark one. */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("hub.theme", "dark"));

  /*
   * Not networkidle: the feed keeps a connection open and polls, so the
   * network never goes quiet and the wait never returns. What the check
   * needs is the element it measures, so it waits for that.
   */
  for (const screen of SCREENS) {
    await page.goto(`${BASE}${screen.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(screen.checks[0].sel, { timeout: 20000 }).catch(() => undefined);
    const tokens = await page.evaluate(`({
      text: ${token("--text")},
      muted: ${token("--muted")},
      emphasis: ${token("--emphasis")},
      searchHeight: ${token("--search-height")},
      searchRadius: ${token("--search-radius")},
      encyclopediaPanel: ${token("--encyclopedia-panel")},
    })`);
    /* A token holds a hex; the browser reports what it painted. */
    const asPainted = async (value) => page.evaluate((v) => {
      const probe = document.createElement("span");
      probe.style.color = v;
      document.body.appendChild(probe);
      const painted = getComputedStyle(probe).color;
      probe.remove();
      return painted;
    }, value);

    for (const check of screen.checks) {
      checked += 1;
      const measured = await page.evaluate(({ sel, prop }) => {
        const el = document.querySelector(sel);
        if (!el) return { missing: true };
        return { value: getComputedStyle(el)[prop] };
      }, { sel: check.sel, prop: check.prop });

      if (measured.missing) {
        failures.push(`${screen.name} ${check.sel}: 要素がない`);
        continue;
      }
      let expected = typeof check.expect === "function" ? check.expect(tokens) : check.expect;
      if (check.prop === "color" || check.prop === "backgroundColor") expected = await asPainted(expected);
      if (measured.value !== expected) {
        failures.push(`${screen.name} ${check.sel} の ${check.prop}: ${measured.value} (期待 ${expected}) — ${check.why}`);
      }
    }
  }

  await page.goto(`${BASE}${LAYOUT.path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-feed", { timeout: 20000 }).catch(() => undefined);
  const layout = await page.evaluate(LAYOUT.measure);
  checked += 1;
  for (const problem of LAYOUT.assert(layout)) failures.push(`${LAYOUT.name}: ${problem}`);
  if (layout.navOverflows) {
    console.log("注意: 左ナビが画面の高さを超えています（設定まで一望できない）");
  }

  await browser.close();

  console.log(`${checked}件を実測しました (${BASE}, ${WIDTH}x${HEIGHT})`);
  if (failures.length) {
    console.log(`\n設計と食い違う点 ${failures.length}件:`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("すべて設計どおりに描画されています");
}

/*
 * Snapshot mode, for taking layers away.
 *
 * The checks above state what the design asks for. A removal needs the
 * opposite question — did anything move that I did not mean to move? So this
 * mode reads every computed property of the post's anatomy and writes it
 * out. Take one before a removal, take one after, and the diff is the whole
 * answer: an empty diff means the declarations that came out were deciding
 * nothing, which is the only safe reason to delete them.
 *
 *   node scripts/measure-screens.mjs --snapshot before.json
 *   ...remove some rules...
 *   node scripts/measure-screens.mjs --snapshot after.json
 *   node scripts/measure-screens.mjs --diff before.json after.json
 */
const ANATOMY = [
  ".tweet", ".tweet__avatar", ".tweet__body", ".tweet__header", ".tweet__name",
  ".tweet__handle", ".tweet__time", ".tweet__text", ".tweet__actions",
  ".tweet__action", ".tweet__action-icon", ".tweet__quote",
];

/*
 * Every surface in the main column that draws a post, plus the right rail.
 *
 * The reading lists are what the editorial layer owns; the post detail and
 * the rail are not, and they are here because most of the rules being taken
 * out of the older stylesheets are scoped broadly enough to reach them. A
 * removal that moves either has to be seen, and it can only be seen if it
 * is measured.
 *
 * The rail holds nothing on a signed-out development instance, so `borrow`
 * lends it a real post: the markup of one from the feed, planted in the
 * empty surface and measured there. What is under test is the stylesheet,
 * not the data — the same markup in two places measures exactly the
 * difference the CSS makes between them, which is the whole question.
 */
const SNAPSHOT_SURFACES = [
  { path: "/", scope: ".home-feed__stream" },
  { path: "/search?q=%E7%81%AF%E3%82%8A", scope: ".search-post-results", borrow: ".tweet" },
  { path: "/posts/curated-feed-release", scope: ".post-detail" },
  { path: "/", scope: ".timeline-rail__list", borrow: ".home-feed__stream > .tweet" },
];

/*
 * Both themes. The measurements ran dark-only for a while, which left the
 * light theme — the one this is read in — with no cover at all, and a
 * stylesheet full of html[data-theme="light"] rules that no diff could see.
 */
const THEMES = ["dark", "light"];

async function snapshot(outPath) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const taken = {};
  for (const theme of THEMES) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => localStorage.setItem("hub.theme", value), theme);
  for (const surface of SNAPSHOT_SURFACES) {
    await page.goto(`${BASE}${surface.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(surface.scope, { timeout: 20000 }).catch(() => undefined);
    taken[surface.scope] = await page.evaluate(({ scope, anatomy, borrow }) => {
      const host = document.querySelector(scope);
      let planted;
      if (host && borrow && !host.querySelector(".tweet")) {
        const donor = document.querySelector(borrow);
        if (donor) {
          planted = donor.cloneNode(true);
          host.append(planted);
        }
      }
      const out = {};
      for (const part of anatomy) {
        const el = document.querySelector(`${scope} ${part}`);
        if (!el) continue;
        const computed = getComputedStyle(el);
        const values = {};
        for (const property of computed) values[property] = computed.getPropertyValue(property);
        out[part] = values;
      }
      /* The page is left as it was found; only the stylesheet was in question. */
      planted?.remove();
      return out;
    }, { scope: surface.scope, anatomy: ANATOMY, borrow: surface.borrow ?? null });
    taken[`${theme} ${surface.scope}`] = taken[surface.scope];
    delete taken[surface.scope];
  }
  }
  await browser.close();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, JSON.stringify(taken, null, 2));
  const parts = Object.values(taken).reduce((total, styles) => total + Object.keys(styles).length, 0);
  console.log(`${parts}箇所の全プロパティを ${outPath} に記録しました`);
}

async function diff(beforePath, afterPath) {
  const { readFileSync } = await import("node:fs");
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));
  const moved = [];
  for (const scope of Object.keys(before)) {
    for (const part of Object.keys(before[scope])) {
      const was = before[scope][part];
      const now = after[scope]?.[part];
      if (!now) {
        moved.push(`${scope} ${part}: 要素が消えた`);
        continue;
      }
      for (const property of Object.keys(was)) {
        if (was[property] !== now[property]) {
          moved.push(`${scope} ${part} の ${property}: ${was[property]} → ${now[property]}`);
        }
      }
    }
  }
  if (!moved.length) {
    console.log("描画は1つも動いていません。剥がした宣言は効いていませんでした");
    return;
  }
  console.log(`動いた指定 ${moved.length}件:`);
  for (const line of moved) console.log(`  ${line}`);
  process.exitCode = 1;
}

const snapshotAt = args.indexOf("--snapshot");
const diffAt = args.indexOf("--diff");
const failed = (error) => {
  console.error(`実測できませんでした: ${error.message}`);
  console.error("開発サーバーが動いているか確認してください (npm run dev)。");
  process.exitCode = 1;
};

if (snapshotAt >= 0) snapshot(args[snapshotAt + 1] ?? "post-surface-snapshot.json").catch(failed);
else if (diffAt >= 0) diff(args[diffAt + 1], args[diffAt + 2]).catch(failed);
else run().catch(failed);
