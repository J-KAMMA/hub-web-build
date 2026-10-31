import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { getHubLocale } from "@/lib/server/locale";
import { HubWalletProvider } from "@/components/hub-wallet-provider";
import { NativeWalletHost } from "@/components/native-wallet-host";
import { MusicPlayerSurface } from "@/components/music-player-surface";
import { MobileAppRegistration } from "@/components/mobile-app-registration";
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation";
import { ExperienceMetrics } from "@/components/experience-metrics";
import { SocialPostAnalytics } from "@/components/social-post-analytics";
import { RouteTransitionIndicator } from "@/components/route-transition-indicator";
import { PageUiScope } from "@/components/page-ui-scope";
import { V2AsideWorkspaceProvider } from "@/components/v2/v2-aside-workspace";
import { V2AiWorkspaceProvider } from "@/components/v2/v2-ai-workspace";
import { HUB_PAGE_UI_REGISTRY } from "@/lib/generated-page-ui-registry";

import "./globals.css";
import "./market.css";
import "./music.css";
import "./horizontal-scroll-rail.css";
import "./right-rail.css";
import "./right-rail-detail.css";
import "./content-pages.css";
import "./right-rail-polish.css";
import "./layout-fix.css";
import "./hub-features.css";
import "./notification-polish.css";
import "./layout-stability.css";
import "./external-media-preview.css";
import "./dark-theme.css";
import "./ai-workbench.css";
import "./future-surfaces.css";
import "./video-hub.css";
import "./video-density.css";
import "./home.css";
import "./platform-catalog.css";
import "./safety-actions.css";
import "./advertising.css";
import "./monetization.css";
import "./advertising-inventory.css";
import "./feed-density.css";
import "./color-system.css";
import "./design-system.css";
import "./page-palettes.css";
import "./commerce.css";
import "./store.css";
import "./engagement-effects.css";
import "./work-gui.css";
import "./responsive-system.css";
import "./global-polish.css";
import "./services.css";
import "./tab-left-column-system.css";
import "./tab-left-column-standard.css";
import "./mobile-app.css";
import "./right-rail-unified.css";
import "./account.css";
import "./interaction-system.css";
import "./ambient-interface.css";
import "./responsive-layout-recovery.css";
import "./motion-system.css";
import "./appleization-system.css";
import "./surface-contract.css";
import "./item-optimization.css";
import "./post-structure.css";
import "./personal-node-video.css";
import "./books.css";
/*
 * Resolve feature state colors after all product styles. This file may use
 * semantic tokens only; column-title-system.css remains last for geometry.
 */
import "./theme-contract.css";
/*
 * Translate jkamma.com's product language into Hub without changing product
 * semantics. Column-title-system.css still resolves the shared header geometry.
 */
import "./jkamma-brand-system.css";
/*
 * Protect reflow, keyboard focus, safe areas and system accessibility
 * preferences after product styling. Column title geometry remains final.
 */
import "./responsive-accessibility.css";
/*
 * Finish the public social surfaces as one product. Shared column-title
 * geometry is still resolved by the final stylesheet below.
 */
import "./social-ui-finish.css";
/*
 * Normalize text hierarchy across product surfaces after feature styles.
 * Geometry remains owned by column-title-system.css.
 */
import "./typography-finish.css";
/*
 * Apply the inventory-backed listing/detail/form/admin/reading page finish
 * after feature typography. Column-title-system.css remains authoritative for
 * the three-column header geometry.
 */
import "./page-category-system.css";
/*
 * Turn the page inventory into a consistent title, action, filter and content
 * hierarchy before the final interaction and column geometry layers.
 */
import "./page-structure-system.css";
/*
 * Separate product-section navigation from in-page view and filter tabs.
 */
import "./tab-structure-system.css";
/*
 * Give the unified market one visual and interaction hierarchy.
 */
import "./market-gui-finish.css";
/*
 * Enforce the final cross-page GUI contract without taking ownership of the
 * three-column header geometry resolved below.
 */
import "./gui-finish.css";
/*
 * Resolve the canonical compact post card after page-specific styling.
 * Column-title-system.css remains last because it owns shell geometry.
 */
import "./post-reference-ui.css";
import "./search-gui-final.css";
/*
 * Persistent content is one continuous surface: entries are separated by
 * hairlines rather than floating as cards. Glass remains available only to
 * explicitly temporary controls and overlays.
 */
import "./continuous-surface.css";
/*
 * Separate the sidebar's navigation groups after the shared surface styles so
 * the rule is not repainted by an earlier product stylesheet.
 */
import "./navigation-grouping.css";
/*
 * The composer opens as a centred dialog rather than sitting above the feed.
 * Loaded after the surface contract so it can reveal the trigger the contract
 * hides on the wide layout.
 */
import "./compose-dialog.css";
/*
 * The shared three-column header contract must remain the final stylesheet.
 * Page and feature styles may describe their content, but must not override
 * the shell's first-row geometry.
 */
import "./editorial-surface.css";
import "./column-title-system.css";
import { getInstanceName, getInstanceOrigin, isJkammaServicesEnabled } from "@/lib/instance-origin";

const instanceName = getInstanceName();

export const metadata: Metadata = {
  metadataBase: new URL(getInstanceOrigin()),
  title: { default: instanceName, template: `%s | ${instanceName}` },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: instanceName,
  },
  applicationName: instanceName,
  formatDetection: { telephone: false },
  description: "選んだ公開名で参加し、短い投稿からじっくり続くやりとりまで共有できるコミュニティ。",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: instanceName,
    title: instanceName,
    description: "選んだ公開名で参加できるコミュニティ。",
    url: getInstanceOrigin(),
  },
};

function pageRoutePatternSource(route: string) {
  if (route === "/") return "^/$";
  const escaped = route
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (segment.startsWith("[...") || segment.startsWith("[[...")) return ".+";
      if (segment.startsWith("[") && segment.endsWith("]")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return `^${escaped}/?$`;
}

const initialPageRegistry = JSON.stringify(
  HUB_PAGE_UI_REGISTRY.map((entry) => ({
    route: entry.route,
    kind: entry.kind,
    pattern: pageRoutePatternSource(entry.route),
  })),
).replaceAll("<", "\\u003c");

const initScript = `
try {
  var l=localStorage.getItem('hub.left-width');
  var r=localStorage.getItem('hub.right-width');
  var t=localStorage.getItem('hub.theme');
  var a=localStorage.getItem('hub.accent');
  var pl=localStorage.getItem('hub.palette');
  var c=localStorage.getItem('hub.compact');
  var s=localStorage.getItem('hub.text-size');
  var m=localStorage.getItem('hub.reduce-motion');
  var fd=localStorage.getItem('hub.feed-density');
  var root=document.documentElement;
  var standalone=typeof matchMedia==='function'&&matchMedia('(display-mode: standalone)').matches;
  var iosStandalone=navigator.standalone===true;
  var androidWebView=/; wv\\)/i.test(navigator.userAgent||'');
  var requestedSurface=new URLSearchParams(location.search).get('hubSurface');
  root.dataset.hubSurface=requestedSurface==='app'||standalone||iosStandalone||androidWebView?'app':'web';
  if(androidWebView){root.dataset.hubNativePlatform='android';}
  if(l){var ln=+l;var lv=ln===252?210:Math.min(420,Math.max(190,ln));root.style.setProperty('--left-width',lv+'px');}
  if(r){var rv=Math.min(520,Math.max(240,+r));root.style.setProperty('--right-width',rv+'px');}
  if(localStorage.getItem('hub.right-open')==='false'){root.style.setProperty('--right-width','58px');}
  var systemDark=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches;
  // 2026-10-29: 保存が無い訪問者の既定は 暗い + 金。保存値と明示の auto（端末に合わせる）が優先。
  root.dataset.theme=(t==='light'||t==='dark')?t:(t==='auto'&&!systemDark?'light':'dark');
  if(pl==='default'){delete root.dataset.palette;}else{root.dataset.palette='gold-ivory';}
  root.dataset.accent=(a==='purple'||a==='pink'||a==='orange'||a==='green'||a==='graphite')?a:(a==='blue'?'blue':'gold');
  root.dataset.compact=(c==='true')?'true':'false';
  root.dataset.textSize=(s==='large')?'large':'standard';
  root.dataset.reduceMotion=(m==='true')?'true':'false';
  root.dataset.feedDensity=(fd==='compact'||fd==='media')?fd:'standard';
  var pages=${initialPageRegistry};
  var currentPath=location.pathname;
  var currentPage=pages.find(function(page){return new RegExp(page.pattern).test(currentPath);});
  root.dataset.pageKind=currentPage?currentPage.kind:'listing';
  root.dataset.pageRoute=currentPage?currentPage.route:'unregistered';
}catch(e){}
`;

/*
 * Inter for Latin text (owner decision 2026-10-31). next/font fetches it at build time and serves
 * it from this origin: the browser never contacts Google. Variable font (covers 400/500/600), latin
 * subset only, so Japanese falls through to Noto Sans JP / device Japanese fonts via --font-ui.
 */
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getHubLocale();
  return (
    <html className={inter.variable} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} data-theme="dark" data-palette="gold-ivory" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>
        <a className="skip-to-content" href="#hub-main">本文へ移動</a>
        <HubWalletProvider>
          <PageUiScope />
          <NativeWalletHost />
          <V2AiWorkspaceProvider><V2AsideWorkspaceProvider>{children}</V2AsideWorkspaceProvider></V2AiWorkspaceProvider>
          <RouteTransitionIndicator />
          <MusicPlayerSurface />
          <MobileBottomNavigation commerceEnabled={isJkammaServicesEnabled()} />
          <MobileAppRegistration />
          <ExperienceMetrics />
          <SocialPostAnalytics />
        </HubWalletProvider>
      </body>
    </html>
  );
}
