/*
 * Release rehearsal: visit /v2 routes signed out on a built app (next start) and
 * record HTTP status, console errors and hydration errors per route.
 *
 *   node scripts/route-rehearsal.mjs --base http://localhost:3055 --json out.json
 *   node scripts/route-rehearsal.mjs --paths /v2,/v2/feed
 *
 * Exit code 1 when any route returns >= 500 or logs a page error / hydration error.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const BASE = flag("--base", "http://localhost:3055").replace(/\/$/, "");
const OUT = flag("--json", "");
const DEFAULT_PATHS = [
  "/v2", "/v2/feed", "/v2/articles", "/v2/posts", "/v2/bbs", "/v2/threads", "/v2/boards",
  "/v2/hubpedia", "/v2/search", "/v2/music", "/v2/videos", "/v2/games", "/v2/market",
  "/v2/store", "/v2/jobs", "/v2/work", "/v2/commissions", "/v2/events", "/v2/classes",
  "/v2/books", "/v2/community", "/v2/research", "/v2/ai", "/v2/token", "/v2/wallet",
  "/v2/world", "/v2/travel", "/v2/local-services", "/v2/services", "/v2/code",
  "/v2/compute", "/v2/developers", "/v2/about", "/v2/legal", "/v2/privacy", "/v2/terms",
  "/v2/auth", "/v2/account", "/v2/messages", "/v2/notifications", "/v2/settings",
  "/v2/earnings", "/v2/creator", "/v2/studio",
];
const PATHS = flag("--paths", "") ? flag("--paths", "").split(",") : DEFAULT_PATHS;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const results = [];
for (const path of PATHS) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  let status = 0;
  let finalUrl = "";
  try {
    const response = await page.goto(BASE + path, { waitUntil: "load", timeout: 60000 });
    status = response ? response.status() : 0;
    await page.waitForTimeout(1200);
    finalUrl = new URL(page.url()).pathname;
  } catch (error) {
    consoleErrors.push(`navigation: ${String(error.message).slice(0, 200)}`);
  }
  const hydration = consoleErrors.filter((t) => /hydrat|#418|#423|#425|did not match/i.test(t));
  results.push({ path, status, finalUrl, consoleErrors, hydrationErrors: hydration.length });
  await page.close();
}
await browser.close();

for (const r of results) {
  const note = r.finalUrl && r.finalUrl !== r.path ? ` -> ${r.finalUrl}` : "";
  console.log(`${r.status} ${r.path}${note} console=${r.consoleErrors.length} hydration=${r.hydrationErrors}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.status >= 500 || r.status === 0 || r.hydrationErrors > 0 || r.consoleErrors.some((t) => t.startsWith("pageerror")));
console.log(`routes=${results.length} bad=${bad.length}`);
process.exit(bad.length ? 1 : 0);
