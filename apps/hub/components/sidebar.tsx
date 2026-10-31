"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Moon, Plus, Sun } from "lucide-react";
import { clsx } from "@/lib/format";
import { hubMessages, type HubLocale } from "@/lib/i18n";
import type { ReactNode } from "react";
import { getHubRuntimeEnvironmentLabel, type HubRuntimeEnvironment } from "@/lib/runtime-environment";
import {
  ACTIVITY_UNREAD_EVENT,
  MESSAGE_UNREAD_EVENT,
  NOTIFICATION_UNREAD_EVENT,
  publishActivityUnreadCounts,
  type ActivityUnreadCounts,
} from "@/lib/notification-client";
import {
  type HubNavigationGroup,
} from "@/lib/sidebar-navigation";
import { HUB_COMPOSE_HASH, requestHubCompose } from "@/lib/compose-events";
import { AccountProfileSwitcher } from "@/components/account-profile-switcher";

interface SidebarItem { href: string; iconHref?: string; label: string; description?: string; symbol?: string; badge?: number; avatarUrl?: string; group?: HubNavigationGroup; }
interface SidebarMessages { home: string; close: string; open: string; navigation: string; unread: string; post: string; theme: string; light: string; dark: string; language: string; }
interface SidebarProps { items: SidebarItem[]; mobileItems?: SidebarItem[]; currentPath: string; currentProfile?: { id: string; handle: string; displayName: string; avatarUrl?: string }; locale?: HubLocale; messages?: SidebarMessages; environment?: HubRuntimeEnvironment; isOpen?: boolean; onToggle?: () => void; onNavigate?: () => void; isDark?: boolean; onToggleTheme?: () => void; }

export function NavIcon({ href }: { href: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const feedIcon = <><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 20.5l1.5-5.3A8.5 8.5 0 1 1 21 11.5Z"/><circle cx="8.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/></>;
  const paths: Record<string, ReactNode> = {
    "/": feedIcon,
    "/feed": feedIcon,
    "/search": <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    "/services": <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    "/notifications": <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    "/ranking": <><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></>,
    "/bbs": <><path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h8M8 13h5"/></>,
    "/community": <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6M15 15c3.5 0 5.5 1.5 6 5"/></>,
    "/videos": <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/></>,
    "/music": <><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
    "/world": <><path d="M4 20V9l5-3v14"/><path d="M9 20V7l6-3v16"/><path d="M15 20v-8l5 2v6"/><circle cx="6.5" cy="15" r="1.2"/></>,
    "/market": <><path d="M4 9h16l-1 12H5L4 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/><path d="M9 14h6"/></>,
    "/market/purchased": <><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 9h8M8 13h5"/><path d="m14 17 2 2 4-5"/></>,
    "/shopping": <><path d="M4 9h16l-1 12H5L4 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></>,
    "/store": <><path d="M4 9h16l-1 12H5L4 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/><path d="M9 14h6M12 11v6"/></>,
    "/advertising": <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 15V11M11 15V8M15 15v-5M19 15V7"/></>,
    "/messages": <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
    "/account": <><circle cx="12" cy="8" r="4"/><path d="M4 21c.5-5 3-7 8-7s7.5 2 8 7"/></>,
    "/token": <><circle cx="12" cy="12" r="9"/><path d="M9 8.5h4a2.5 2.5 0 0 1 0 5H9m3-8v13m-3-2h5"/></>,
    "/lists": <><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
    "/bookmarks": <path d="M6 3h12v18l-6-4-6 4V3Z"/>,
    "/hubpedia": <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23V5.5Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23V5.5Z"/></>,
    "/articles": <><path d="M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h6M9 16h6"/></>,
    "/research": <><path d="M8 4h8M10 4v6l-6 9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-9V4M8 15h8"/></>,
    /* データの持ち出しが使う汎用の箱の絵。Vault の画面は外したが絵の鍵は残す。 */
    "/vault": <><path d="M4 7h16v14H4z"/><path d="M7 7V4h10v3M9 12h6M12 12v4"/></>,
    "/work": <><path d="M4 7h16v13H4z"/><path d="M9 7V5h6v2M8 12h8M8 16h5"/></>,
    "/jobs": <><path d="M4 7h16v13H4z"/><path d="M9 7V5h6v2M8 12h8M8 16h5"/></>,
    "/ai": <><path d="M12 3.2 14 9l5.8 2-5.8 2-2 5.8-2-5.8-5.8-2L10 9l2-5.8Z"/><path d="m18.5 3 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5ZM5.5 17l.65 1.85L8 19.5l-1.85.65L5.5 22l-.65-1.85L3 19.5l1.85-.65L5.5 17Z"/></>,
    "/compute": <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9zM8 1v3M12 1v3M16 1v3M8 20v3M12 20v3M16 20v3M1 8h3M1 12h3M1 16h3M20 8h3M20 12h3M20 16h3"/></>,
    "/node": <><rect x="9" y="9" width="6" height="6" rx="2"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 6.5 3 3M17 6.5l-3 3M7 17.5l3-3M17 17.5l-3-3"/></>,
    "/wallet": <><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 9h15M15 12h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><circle cx="16.5" cy="14.5" r=".6" fill="currentColor" stroke="none"/></>,
    "/settings": <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06-.06A1.7 1.7 0 0 0 19.4 9c.18.38.47.7.84.91.33.2.72.3 1.1.3H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/></>,
    "/about": <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21c.5-5 3-7 8-7s7.5 2 8 7"/></>
  };
  const key = href.startsWith("/profile/") ? "profile" : href;
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[key] ?? paths["/"]}</svg>;
}

export function Sidebar({ items, mobileItems, currentPath, currentProfile, locale = "ja", messages = hubMessages(locale).sidebar, environment = "development", isOpen = true, onToggle = () => {}, onNavigate = onToggle, isDark = true, onToggleTheme = () => {} }: SidebarProps) {
  /* 読み手が居る面。v2 から描かれたら足元の規約も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();

  /*
   * A family whose pages do not all live under one path needs its aliases
   * listed. A thread is at /threads/<id> and belongs to the board list at
   * /bbs, so without this the entry goes dark the moment you open a thread.
   */
  const NAV_ALIASES: Record<string, readonly string[]> = {
    "/store": ["/store", "/shopping"],
    "/bbs": ["/bbs", "/threads"],
  };
  const isActive = (href: string) => {
    if (href === "/research" && (currentPath === "/hubpedia" || currentPath.startsWith("/hubpedia/"))) return true;
    if (href === "/") return currentPath === "/";
    if (href === "/articles") return currentPath === "/articles" || currentPath.startsWith("/articles/") || currentPath.startsWith("/adult/articles/");
    if (href === "/market") return currentPath === "/market" || (currentPath.startsWith("/market/") && !currentPath.startsWith("/market/purchased"));
    const paths = NAV_ALIASES[href] ?? [href];
    return paths.some((path) => currentPath === path || currentPath.startsWith(`${path}/`));
  };
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(
    () => items.find((item) => item.href === "/notifications")?.badge ?? 0
  );
  const [messageUnreadCount, setMessageUnreadCount] = useState(
    () => items.find((item) => item.href === "/messages")?.badge ?? 0
  );
  useEffect(() => {
    const updateUnreadCount = (event: Event) => {
      setNotificationUnreadCount((event as CustomEvent<number>).detail);
    };
    window.addEventListener(NOTIFICATION_UNREAD_EVENT, updateUnreadCount);
    return () => window.removeEventListener(NOTIFICATION_UNREAD_EVENT, updateUnreadCount);
  }, []);
  useEffect(() => {
    const updateUnreadCount = (event: Event) => {
      setMessageUnreadCount((event as CustomEvent<number>).detail);
    };
    window.addEventListener(MESSAGE_UNREAD_EVENT, updateUnreadCount);
    return () => window.removeEventListener(MESSAGE_UNREAD_EVENT, updateUnreadCount);
  }, []);
  useEffect(() => {
    if (!currentProfile?.id) return;
    let controller: AbortController | null = null;
    let requestInFlight = false;
    let lastRequestedAt = 0;
    const refreshUnreadCount = (force = false) => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (requestInFlight || (!force && now - lastRequestedAt < 15_000)) return;
      requestInFlight = true;
      lastRequestedAt = now;
      controller?.abort();
      controller = new AbortController();
      void fetch("/api/activity/counts", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<ActivityUnreadCounts> : null)
        .then((payload) => {
          if (typeof payload?.notificationCount === "number" && typeof payload.messageCount === "number") {
            publishActivityUnreadCounts(payload);
          }
        })
        .catch(() => undefined)
        .finally(() => { requestInFlight = false; });
    };
    const onFocus = () => refreshUnreadCount();
    const onVisibilityChange = () => refreshUnreadCount();
    refreshUnreadCount(true);
    const pollId = window.setInterval(() => refreshUnreadCount(), 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller?.abort();
      window.clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [currentProfile?.id]);
  useEffect(() => {
    setNotificationUnreadCount(items.find((item) => item.href === "/notifications")?.badge ?? 0);
    setMessageUnreadCount(items.find((item) => item.href === "/messages")?.badge ?? 0);
  }, [items]);
  useEffect(() => {
    const updateCounts = (event: Event) => {
      const counts = (event as CustomEvent<ActivityUnreadCounts>).detail;
      setNotificationUnreadCount(counts.notificationCount);
      setMessageUnreadCount(counts.messageCount);
    };
    window.addEventListener(ACTIVITY_UNREAD_EVENT, updateCounts);
    return () => window.removeEventListener(ACTIVITY_UNREAD_EVENT, updateCounts);
  }, []);
  const withLiveNotificationBadge = (navigation: SidebarItem[]) => navigation.map((item) =>
    item.href === "/notifications"
      ? { ...item, badge: notificationUnreadCount }
      : item.href === "/messages"
        ? { ...item, badge: messageUnreadCount }
        : item
  );
  const navigationItems = withLiveNotificationBadge(items);
  const profileItem = navigationItems.find((item) => (item.iconHref ?? item.href).startsWith("/profile/"));
  const desktopNavigationItems = navigationItems.filter((item) => item !== profileItem);
  const activateNavigation = () => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || event.currentTarget.target === "_blank"
      || event.currentTarget.hasAttribute("download")
    ) {
      return;
    }
    // Keep the anchor/Next Link navigation intact. Preventing the native
    // action here made a stalled client transition look like a dead link.
    if (typeof document !== "undefined" && document.documentElement.dataset.hubSurface === "app") {
      window.setTimeout(onNavigate, 0);
    }
  };
  const renderNavigationItems = (navigation: SidebarItem[]) => navigation.map((item, index) => {
    const destination = item.iconHref ?? item.href;
    const isProfile = destination.startsWith("/profile/");
    // Groups stay ordering metadata. Each run is separated by a rule rather
    // than a heading, so the list reads in sections without adding labels a
    // screen reader would have to walk past.
    const startsGroup = index > 0 && navigation[index - 1].group !== item.group;
    return <React.Fragment key={`${item.href}:${destination}`}>
      {startsGroup ? <span className="sidebar__nav-rule" role="presentation" aria-hidden="true" /> : null}
      <Link key={item.href} href={item.href} prefetch={false} onClick={activateNavigation()} aria-label={!isOpen ? item.label : undefined} title={!isOpen ? item.label : undefined} data-nav-group={item.group} className={clsx("sidebar__link", isProfile && "sidebar__profile-nav-item", isActive(destination) && "sidebar__link--active")}>
        <span className={clsx("sidebar__nav-icon", isProfile && "sidebar__profile-avatar")} data-icon-href={destination}>{isProfile && item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <NavIcon href={destination} />}</span>
        {isOpen && <span className="sidebar__link-copy"><span className="sidebar__label">{item.label}</span>{item.description && <small>{item.description}</small>}</span>}
        {item.badge ? <span className="sidebar__badge" aria-label={`${item.badge}${messages.unread}`} title={`${item.badge}${messages.unread}`} /> : null}
      </Link>
    </React.Fragment>;
  });
  return (
    <aside className={clsx("sidebar", !isOpen && "sidebar--collapsed")}>
      <div className="sidebar__brand" data-shell-column-header="left"><div className="sidebar__brand-top">
        {isOpen && (
          <>
            <span className="sidebar__header-balance" aria-hidden="true" />
            <div className="sidebar__brand-identity">
              <Link className="sidebar__wordmark" href="/" prefetch={false} onClick={activateNavigation()} aria-label={messages.home}>
                <strong aria-hidden="true">Hub</strong>
              </Link>
              <span className="sidebar__environment" data-environment={environment}>{getHubRuntimeEnvironmentLabel(environment, locale)}</span>
            </div>
          </>
        )}
        <button type="button" className="sidebar__collapse hub-icon-button" onClick={onToggle} aria-expanded={isOpen} aria-label={isOpen ? messages.close : messages.open}>{isOpen ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button>
      </div></div>
      <nav className="sidebar__nav sidebar__nav--desktop" aria-label={messages.navigation}>
        {renderNavigationItems(desktopNavigationItems)}
        {isOpen && <div className="sidebar__nav-footer">
          {/* v2 へ戻る道。v2 から既存の画面へ渡した先で迷子にならないための1行（旦那様の承認、2026-09-03）。 */}
          <Link className="sidebar__personal-site" href="/v2">新しい画面（v2）へ <span aria-hidden="true">→</span></Link>
          <a className="sidebar__personal-site" href="https://jkamma.com">jkamma.com <span aria-hidden="true">↗</span></a>
          <div className="sidebar__legal-links"><Link href={hubSurfacePath(surface, "/terms")}>利用規約</Link><Link href={hubSurfacePath(surface, "/privacy")}>プライバシー</Link><Link href={hubSurfacePath(surface, "/legal")}>サービス条件</Link></div>
        </div>}
      </nav>
      {mobileItems ? <nav className="sidebar__nav sidebar__nav--mobile" aria-label={messages.navigation}>
        {renderNavigationItems(withLiveNotificationBadge(mobileItems))}
      </nav> : null}
      <div className="sidebar__footer">
        {profileItem ? <div className="sidebar__profile-pinned">
          {currentProfile?.id
            ? <AccountProfileSwitcher currentProfile={currentProfile} collapsed={!isOpen} />
            : <nav aria-label={profileItem.label}>{renderNavigationItems([profileItem])}</nav>}
        </div> : null}
        <Link
          href={`${currentPath === "/" ? "/" : "/feed"}${HUB_COMPOSE_HASH}`}
          onClick={(event) => {
            /*
             * The composer is part of the timeline, so it can only be opened in
             * place when the timeline is already mounted. Elsewhere the link
             * navigates and the hash asks the feed to open it on arrival.
             * Signed out there is no composer to open at all, only the feed's
             * sign-in prompt, so the link is left alone.
             */
            if (currentProfile?.id && (currentPath === "/feed" || currentPath === "/") && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
              event.preventDefault();
              requestHubCompose();
              return;
            }
            activateNavigation()(event);
          }}
          className="sidebar__compose"
          aria-label={messages.post}
          title={messages.post}
        >
          <Plus aria-hidden="true" />
          <span className="sidebar__compose-label">{messages.post}</span>
        </Link>
        <button type="button" className="sidebar__theme-toggle" onClick={onToggleTheme} aria-label={messages.theme}>{isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}{isOpen && <span>{isDark ? messages.light : messages.dark}</span>}</button>
      </div>
    </aside>
  );
}
