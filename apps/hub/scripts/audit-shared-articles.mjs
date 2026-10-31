import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:3020").replace(/\/$/u, "");
const outputDirectory = new URL("../artifacts/shared-articles/", import.meta.url);
const routes = ["/articles", "/vault", "/market/digital"];
const viewports = [1024, 1440];
const browser = await chromium.launch({ executablePath: process.env.HUB_BROWSER_EXECUTABLE || undefined });

await mkdir(outputDirectory, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => window.localStorage.setItem("hub.theme", "dark"));
  for (const width of viewports) for (const route of routes) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    const responses = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) responses.push({ status: response.status(), url: response.url() });
    });
    await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1800);
    const result = await page.evaluate(() => ({
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      articleCards: document.querySelectorAll("[aria-label='記事の利用条件']").length,
      pageLeftColumns: document.querySelectorAll("[data-hub-page-left-column]").length,
      mainSearch: document.querySelectorAll("[data-hub-page-main-search]").length,
      emptyActions: document.querySelectorAll(".hub-articles__empty a, .hub-articles__empty button").length,
      hasAdultVaultTitle: document.body.textContent?.includes("成人向け限定記事") ?? false,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    const slug = route.slice(1).replaceAll("/", "-");
    await page.screenshot({ path: new URL(`${slug}-${width}-dark.png`, outputDirectory).pathname.slice(1), fullPage: false });
    console.log(JSON.stringify({ route, width, ...result, errors, responses }, null, 2));
    await page.close();
  }
  await context.close();
} finally {
  await browser.close();
}
