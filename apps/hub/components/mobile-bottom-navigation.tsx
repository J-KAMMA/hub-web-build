"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NavIcon } from "@/components/sidebar";
import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";
import { MESSAGE_UNREAD_EVENT, NOTIFICATION_UNREAD_EVENT } from "@/lib/notification-client";
import { isCurrent } from "@/lib/v2-nav-current";

type Destination = readonly [href: string, label: string];

/*
 * 2026-10-11: the same five destinations on every screen (Timeline, Videos,
 * Market, Notifications, Messages). AI is a Hub Desktop feature and is not in
 * the Web navigation. The bar is
 * laid out as five equal columns, so the set must stay at exactly five.
 */
const destinationGroups = {
  home: [["/", "タイムライン"], ["/videos", "動画"], ["/market", "マーケット"], ["/notifications", "通知"], ["/messages", "メッセージ"]],
} as const satisfies Record<string, readonly Destination[]>;

/*
 * 2026-10-13: a self-hosted Hub has no Market (Commerce is a jkamma service), so its slot goes to
 * Search to keep five columns. This component is a client one and cannot read the server env, so
 * the layout passes the flag in.
 */
const selfHostedHome: readonly Destination[] = [["/", "タイムライン"], ["/videos", "動画"], ["/search", "検索"], ["/notifications", "通知"], ["/messages", "メッセージ"]];

/*
 * v2 の下のタブ（2026-10-14、SPEC 4.1）。ホーム・動画・音楽・通知・メッセージの5つ。
 * 携帯では左の縦の帯を出さないので、記事・マーケット・設定などは上の帯のメニューから入る。
 * 現在地は v2 のナビと同じ規則（lib/v2-nav-current.ts）で決める。
 */
const v2Destinations: readonly Destination[] = [["/", "ホーム"], ["/videos", "動画"], ["/music", "音楽"], ["/notifications", "通知"], ["/messages", "メッセージ"]];

const hiddenPrefixes = ["/auth", "/onboarding", "/admin", "/terms", "/privacy", "/copyright", "/appeal", "/ads/"];

/* v2 から見ているか。頭が "/v2" の道だけ。"/v2beta" は既存の道。 */
function surfaceOf(pathname: string): HubUiSurface {
  return pathname === "/v2" || pathname.startsWith("/v2/") ? "/v2" : "";
}

function destinationsFor(pathname: string, commerceEnabled: boolean): readonly Destination[] | null {
  /*
   * 群は「どの画面か」で選ぶ。面の頭は先に外す（2026-09-04）。
   * 外さないと /v2/music は "/music" で始まらず音楽の群にならない。
   */
  const surface = surfaceOf(pathname);
  if (surface) pathname = pathname.slice(surface.length) || "/";
  if (hiddenPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return null;
  return commerceEnabled ? destinationGroups.home : selfHostedHome;
}

/* 未読の点。件数は持たず、1以上かどうかだけ見せる。最初の値は一度だけ取り、あとは全体のイベントで動く。 */
function UnreadDot({ kind }: { kind: "notifications" | "messages" }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const name = kind === "notifications" ? NOTIFICATION_UNREAD_EVENT : MESSAGE_UNREAD_EVENT;
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      if (Number.isFinite(next)) setCount(Math.max(0, Math.trunc(next)));
    };
    window.addEventListener(name, onChange);
    fetch("/api/activity/counts", { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { notificationCount?: number; messageCount?: number } | null) => {
        const next = kind === "notifications" ? payload?.notificationCount : payload?.messageCount;
        if (alive && typeof next === "number") setCount(Math.max(0, Math.trunc(next)));
      })
      .catch(() => undefined);
    return () => { alive = false; window.removeEventListener(name, onChange); };
  }, [kind]);
  return count > 0 ? <span className="shell__mobile-nav-dot" role="img" aria-label={`未読${count}件`} /> : null;
}

export function MobileBottomNavigation({ commerceEnabled = true }: { commerceEnabled?: boolean } = {}) {
  const pathname = usePathname() || "/";
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => setPendingPath(null), [pathname]);
  /*
   * v2 から見ているときは v2 の中に留まる（2026-09-04）。
   *
   * この帯は 390px で見える。v2 を携帯で見ている人が押すと、5つとも
   * 既存の画面へ出ていた（実測: /v2 で高さ61px、行き先は / /search
   * /notifications /messages /account）。
   *
   * 群の選び方も同じ理由で外れていた。/v2/music は "/music" で始まらないので
   * 音楽の群にならず、いつも既定の群だった。頭は destinationsFor が外す。
   *
   * この部品は layout に在り、v2 の外郭の外側なので文脈は届かない。URL で判断する。
   */
  const surface = surfaceOf(pathname);
  const destinations = destinationsFor(pathname, commerceEnabled);
  // The bar is rendered on every surface and width; the stylesheets decide
  // where it is shown, so the compact web layout is never left without
  // navigation while the installed app keeps using its own bottom rail.
  if (!destinations) return null;
  const v2 = surface === "/v2";
  const shown = v2 ? v2Destinations : destinations;

  return (
    <nav className={v2 ? "shell__mobile-bottom-nav shell__mobile-bottom-nav--v2" : "shell__mobile-bottom-nav"} aria-label="スマホ用メインナビゲーション">
      {shown.map(([target, label]) => {
        /* 行き先は今いる面の中へ。v2 に無い画面はそのまま既存の面へ渡る。 */
        const href = surface === "/v2" && target === "/" ? "/v2" : hubSurfacePath(surface, target);
        const active = pendingPath === href || (v2 ? isCurrent(href, pathname) : href === "/" || href === "/v2" ? pathname === href : pathname.startsWith(href));
        const pending = pendingPath === href && pathname !== href;
        return (
          <Link
            key={href}
            href={href}
            prefetch={false}
            onClick={() => setPendingPath(href)}
            aria-current={active ? "page" : undefined}
            aria-busy={pending || undefined}
            data-pending={pending || undefined}
          >
            <span className="shell__mobile-nav-mark"><NavIcon href={target} />{v2 && target === "/notifications" ? <UnreadDot kind="notifications" /> : null}{v2 && target === "/messages" ? <UnreadDot kind="messages" /> : null}</span>
            <span>{label}</span>
            {pending ? <span className="shell__mobile-nav-status" role="status">読み込み中</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
