"use client";

import React, { type ReactNode } from "react";

import { NavIcon } from "@/components/sidebar";
import { ShellFrame } from "@/components/shell-frame";
import styles from "@/components/route-recovery-client-shell.module.css";

const RECOVERY_DESTINATIONS = [
  { href: "/", label: "ホーム" },
  { href: "/feed", label: "フィード" },
  { href: "/search", label: "検索" },
  { href: "/hubpedia", label: "Hubpedia" },
] as const;

function RecoveryLeftRail({ isOpen = true }: { isOpen?: boolean }) {
  return (
    <aside
      className={`${styles.leftRail} ${isOpen ? "" : styles.collapsed}`}
      data-route-recovery-rail="left"
    >
      <div className={styles.brand} data-shell-column-header="left">
        <a href="/" aria-label="Hubのホーム">
          <span className={styles.brandMark} aria-hidden="true">H</span>
          <span className={styles.brandLabel}>Hub</span>
        </a>
      </div>
      <nav className={styles.navigation} aria-label="復旧時のナビゲーション">
        {RECOVERY_DESTINATIONS.map((destination) => (
          <a key={destination.href} href={destination.href} title={isOpen ? undefined : destination.label}>
            <NavIcon href={destination.href} />
            <span className={styles.linkLabel}>{destination.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}

function RecoveryRightRail() {
  return (
    <aside className={styles.rightRail} data-route-recovery-rail="right">
      <p>復旧を待たずに、主要なページへ移動できます。</p>
      <nav className={styles.rightNavigation} aria-label="復旧時の移動先">
        {RECOVERY_DESTINATIONS.slice(0, 3).map((destination) => (
          <a key={destination.href} href={destination.href}>
            {destination.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}

export function RouteRecoveryClientShell({ children }: { children: ReactNode }) {
  return (
    <ShellFrame
      currentPath="/__route-error"
      left={<RecoveryLeftRail />}
      right={<RecoveryRightRail />}
      showTimelineRail
      wideContent
    >
      {children}
    </ShellFrame>
  );
}
