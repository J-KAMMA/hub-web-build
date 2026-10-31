import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:3020").replace(/\/$/, "");
const outputDirectory = new URL("../artifacts/ui-standards/", import.meta.url);
const routes = ["/", "/bbs", "/videos", "/music", "/hubpedia", "/adult/videos"];
const browser = await chromium.launch({ executablePath: process.env.HUB_BROWSER_EXECUTABLE || undefined });
const failures = [];

await mkdir(outputDirectory, { recursive: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => window.localStorage.setItem("hub.theme", "dark"));
  await context.addCookies([{ name: "hub_adult_opt_in", value: "1", url: `${base}/adult`, httpOnly: true, sameSite: "Lax" }]);

  for (const route of routes) {
    const page = await context.newPage();
    const errors = [];
    const httpFailures = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) httpFailures.push({ status: response.status(), url: response.url() });
    });
    await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);
    const result = await page.evaluate(() => {
      const left = document.querySelector("[data-hub-page-left-column]");
      const layout = left?.parentElement;
      const leftHeader = left?.querySelector(".tab-left-column__header");
      const header = leftHeader && leftHeader.getBoundingClientRect().height > 0 ? leftHeader : document.querySelector(".shell-page-header");
      const active = [...(left?.querySelectorAll(".is-active,.tl-tab--active,.bbs-thread-directory__current,[aria-current='page'],[aria-selected='true'],[aria-pressed='true']") ?? [])]
        .find((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
      const search = document.querySelector(".tab-main-search-header form[role='search'],.shell-page-search,.video-search,.music-search");
      const rect = (element) => element?.getBoundingClientRect();
      const style = (element) => element ? getComputedStyle(element) : null;
      return {
        title: document.title,
        leftClass: left?.className ?? null,
        layoutClass: layout?.className ?? null,
        layoutDisplay: style(layout)?.display ?? null,
        layoutColumns: style(layout)?.gridTemplateColumns ?? null,
        leftTop: Math.round(rect(left)?.top ?? -1),
        leftWidth: Math.round(rect(left)?.width ?? 0),
        headerHeight: Math.round(rect(header)?.height ?? 0),
        activeRadius: Number.parseFloat(style(active)?.borderRadius ?? "0"),
        searchClass: search?.className ?? null,
        searchTop: Math.round(rect(search)?.top ?? -1),
        searchHeight: Math.round(rect(search)?.height ?? 0),
        searchRadius: Number.parseFloat(style(search)?.borderRadius ?? "0"),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const slug = route === "/" ? "feed" : route.slice(1).replaceAll("/", "-");
    await page.screenshot({ path: new URL(`${slug}-1440-dark.png`, outputDirectory).pathname.slice(1), fullPage: false });
    console.log(JSON.stringify({ route, ...result, errors, httpFailures }, null, 2));
    if (!result.leftClass) failures.push(`${route}: page-left column is missing`);
    if (result.leftWidth !== 228) failures.push(`${route}: page-left column width is ${result.leftWidth}px`);
    if (result.headerHeight !== 58) failures.push(`${route}: page-left header height is ${result.headerHeight}px`);
    if (result.activeRadius < 8) failures.push(`${route}: selected control radius is ${result.activeRadius}px`);
    if (result.searchHeight !== 44) failures.push(`${route}: search height is ${result.searchHeight}px`);
    if (result.searchRadius < 8) failures.push(`${route}: search radius is ${result.searchRadius}px`);
    if (result.horizontalOverflow > 1) failures.push(`${route}: horizontal overflow is ${result.horizontalOverflow}px`);
    if (errors.length) failures.push(`${route}: ${errors.length} browser error(s)`);
    if (httpFailures.some(({ status }) => status >= 500)) failures.push(`${route}: server response failed`);
    await page.close();
  }
  await context.close();
} finally {
  await browser.close();
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
