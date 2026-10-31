/*
 * Where the design disagrees with itself.
 *
 * A design reads as finished when the same thing is the same size everywhere:
 * one type ramp, one inset from a column's edge, one control height, one
 * divider. It reads as unfinished when a heading is 21px here and 26px there
 * for no reason a reader could name — and that kind of drift is invisible to
 * anyone reading a stylesheet, because each value looks reasonable alone.
 *
 * So this walks the screens and collects the vocabulary each one actually
 * paints: the size of its page heading, how far its content sits from the
 * column edge, how tall its controls are, what its dividers are made of. It
 * reports the values that appear only once or twice — the outliers are the
 * work, and everything that agrees is already settled.
 *
 *   node scripts/survey-consistency.mjs
 *   node scripts/survey-consistency.mjs --base https://…   (against staging)
 */

import { chromium } from "playwright";

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const BASE = baseAt >= 0 ? args[baseAt + 1] : "http://localhost:3111";

const ROUTES = [
  "/", "/bbs", "/search?q=%E7%81%AF%E3%82%8A", "/music", "/hubpedia",
  "/market", "/bookmarks", "/lists", "/settings", "/notifications", "/videos",
];

/* What every screen is asked the same question about. */
const VOCABULARY = `(() => {
  const main = document.querySelector(".main-content") ?? document.body;
  const px = (v) => Math.round(parseFloat(v) || 0);
  const seen = { heading: [], inset: [], control: [], divider: [], radius: [] };

  /*
   * The heading a reader sees, not the one a screen reader hears. Two
   * screens reported 36px against everyone else's 14 and the difference was
   * entirely a .sr-only h1 — a heading clipped to one pixel and parked off
   * the layout, whose font-size is whatever it inherited and means nothing.
   * Measuring what is not painted is how a survey invents a problem.
   */
  const visible = (el) => {
    const c = getComputedStyle(el);
    if (c.display === "none" || c.visibility === "hidden") return false;
    if (c.clip === "rect(0px, 0px, 0px, 0px)" || c.clipPath === "inset(50%)") return false;
    const box = el.getBoundingClientRect();
    return box.width > 4 && box.height > 4;
  };
  const h1 = [...main.querySelectorAll("h1, h2")].find(visible);
  if (h1) seen.heading.push(px(getComputedStyle(h1).fontSize));

  /* How far the first real content sits from the column's own left edge. */
  const column = main.getBoundingClientRect();
  const first = [...main.querySelectorAll("p, h1, h2, article, .tweet")]
    .find((el) => el.getBoundingClientRect().height > 10);
  if (first) seen.inset.push(Math.round(first.getBoundingClientRect().left - column.left));

  for (const el of [...main.querySelectorAll("button, a.button, input[type=search]")].slice(0, 12)) {
    const r = el.getBoundingClientRect();
    if (r.height > 8) seen.control.push(Math.round(r.height));
    const radius = px(getComputedStyle(el).borderRadius);
    if (r.height > 8) seen.radius.push(radius);
  }

  /*
   * A divider is a line between things, not the edge of a thing. The first
   * version of this counted any solid top border and reported the outline of
   * a button as a white divider on three screens — the button was "認証状態を
   * 確認中…" and its border is the text colour, which is correct for a button
   * and alarming for a rule. So: only elements that draw a top or bottom edge
   * without drawing the other three.
   */
  for (const el of [...main.querySelectorAll("*")].slice(0, 400)) {
    const c = getComputedStyle(el);
    const top = px(c.borderTopWidth), bottom = px(c.borderBottomWidth);
    const left = px(c.borderLeftWidth), right = px(c.borderRightWidth);
    const horizontal = (top > 0 || bottom > 0) && left === 0 && right === 0;
    if (!horizontal) continue;
    const width = top > 0 ? top : bottom;
    const colour = top > 0 ? c.borderTopColor : c.borderBottomColor;
    if (c.borderTopStyle === "none" && c.borderBottomStyle === "none") continue;
    seen.divider.push(width + "px " + colour);
  }
  return seen;
})()`;

const tally = { heading: new Map(), inset: new Map(), control: new Map(), divider: new Map(), radius: new Map() };
const add = (kind, value, route) => {
  const key = String(value);
  if (!tally[kind].has(key)) tally[kind].set(key, new Set());
  tally[kind].get(key).add(route);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 900 } });
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.setItem("hub.theme", "dark"));

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const seen = await page.evaluate(VOCABULARY);
  for (const kind of Object.keys(seen)) {
    for (const value of seen[kind]) add(kind, value, route);
  }
}
await browser.close();

const LABEL = {
  heading: "見出しの大きさ", inset: "列の端からの内寄せ", control: "操作の高さ",
  divider: "区切り線", radius: "角丸",
};

for (const kind of Object.keys(tally)) {
  const rows = [...tally[kind].entries()].sort((a, b) => b[1].size - a[1].size);
  if (!rows.length) continue;
  console.log(`\n${LABEL[kind]}`);
  for (const [value, routes] of rows) {
    const mark = routes.size === 1 ? "  ← 1画面だけ" : "";
    console.log(`  ${String(value).padEnd(26)} ${String(routes.size).padStart(2)}画面  ${[...routes].slice(0, 4).join(" ")}${mark}`);
  }
}
