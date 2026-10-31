/*
 * Browser-level regression for the page header breakpoint. CSS for the shared
 * search field is split across chunks, so source order and jsdom are not proof
 * of what the browser paints.
 *
 * Usage:
 *   node scripts/measure-responsive-shell.mjs
 *   node scripts/measure-responsive-shell.mjs --base http://127.0.0.1:3020
 *   node scripts/measure-responsive-shell.mjs --path /hubpedia
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const base = valueAfter("--base", "http://127.0.0.1:3020").replace(/\/$/, "");
const route = valueAfter("--path", "/hubpedia");
const matrix = [390, 900, 901, 1440];
const failures = [];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: matrix[0], height: 900 } });
  for (const width of matrix) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell-page-header", { timeout: 20_000 });
    const measured = await page.evaluate(() => {
      const full = document.querySelector(".shell-page-search");
      const compact = document.querySelector(".shell-page-search-link");
      const title = document.querySelector(".shell-page-header__title");
      const header = document.querySelector(".shell-page-header");
      const rect = (element) => element?.getBoundingClientRect();
      return {
        fullDisplay: full ? getComputedStyle(full).display : "missing",
        compactDisplay: compact ? getComputedStyle(compact).display : "missing",
        titleWidth: Math.round(rect(title)?.width ?? 0),
        headerWidth: Math.round(rect(header)?.width ?? 0),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const compactExpected = width <= 900;
    if (compactExpected && measured.fullDisplay !== "none") failures.push(`${width}px: full search is ${measured.fullDisplay}, expected none`);
    if (compactExpected && measured.compactDisplay !== "grid") failures.push(`${width}px: compact search is ${measured.compactDisplay}, expected grid`);
    if (!compactExpected && measured.fullDisplay === "none") failures.push(`${width}px: full search is hidden`);
    if (!compactExpected && measured.compactDisplay !== "none") failures.push(`${width}px: compact search is ${measured.compactDisplay}, expected none`);
    if (measured.titleWidth <= 0 || measured.headerWidth <= 0) failures.push(`${width}px: header title is not visible`);
    if (measured.horizontalOverflow > 1) failures.push(`${width}px: page overflows horizontally by ${measured.horizontalOverflow}px`);
    console.log(`${width}px full=${measured.fullDisplay} compact=${measured.compactDisplay} title=${measured.titleWidth}px overflow=${measured.horizontalOverflow}px`);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`Responsive shell failures (${base}${route}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Responsive shell passed at ${matrix.join("/")}px (${base}${route}).`);
}
