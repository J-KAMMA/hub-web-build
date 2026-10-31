import type { ReactNode } from "react";

import { cx } from "./cx";

/*
 * Skeletons that match the final layout (SPEC 3, 6). Each variant uses the same
 * dimensions as the component it stands in for, so nothing moves when data arrives.
 *   post   40px face, name row 20, body 2 x 24, action row 36
 *   video  16:9 art, 36px face, two title lines
 *   music  56px row, 40px art, two lines
 *   row    list row, 56px
 * Server-component safe. Announces "loading" once.
 */
export type SkeletonKind = "post" | "video" | "music" | "row";

export function Skeleton({
  kind,
  count = 3,
  label = "読み込んでいます",
  className,
}: {
  kind: SkeletonKind;
  count?: number;
  label?: string;
  className?: string;
}) {
  const items = Array.from({ length: Math.max(1, Math.min(count, 12)) }, (_, index) => index);
  return (
    <div className={cx("ui-skel", `ui-skel--${kind}`, className)} role="status" aria-busy="true" aria-live="polite">
      <span className="ui-sr">{label}</span>
      {items.map((index) => (
        <div key={index} className="ui-skel__item" aria-hidden="true">
          {kind === "post" ? (
            <>
              <span className="ui-skel__block ui-skel__face" />
              <span className="ui-skel__col">
                <span className="ui-skel__block ui-skel__line ui-skel__line--name" />
                <span className="ui-skel__block ui-skel__line" />
                <span className="ui-skel__block ui-skel__line ui-skel__line--half" />
                <span className="ui-skel__block ui-skel__actions" />
              </span>
            </>
          ) : kind === "video" ? (
            <>
              <span className="ui-skel__block ui-skel__art ui-skel__art--wide" />
              <span className="ui-skel__meta">
                <span className="ui-skel__block ui-skel__face ui-skel__face--36" />
                <span className="ui-skel__col">
                  <span className="ui-skel__block ui-skel__line" />
                  <span className="ui-skel__block ui-skel__line ui-skel__line--half" />
                </span>
              </span>
            </>
          ) : kind === "music" ? (
            <>
              <span className="ui-skel__block ui-skel__art ui-skel__art--square" />
              <span className="ui-skel__col">
                <span className="ui-skel__block ui-skel__line" />
                <span className="ui-skel__block ui-skel__line ui-skel__line--half" />
              </span>
            </>
          ) : (
            <>
              <span className="ui-skel__block ui-skel__face" />
              <span className="ui-skel__col">
                <span className="ui-skel__block ui-skel__line" />
                <span className="ui-skel__block ui-skel__line ui-skel__line--half" />
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/*
 * Presets (2026-10-29, G2). Bare shapes sized like the final layout so nothing
 * shifts when data arrives. They carry aria-hidden; wrap a group in SkeletonGroup
 * (or use SkeletonList) so "loading" is announced once.
 *   SkeletonRow   avatar 40 + two lines, 72px
 *   SkeletonCard  16:9 media + two lines
 *   SkeletonTile  1:1 media + two lines
 */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cx("ui-skel2 ui-skel2--row", className)} aria-hidden="true">
      <span className="ui-skel__block ui-skel__face" />
      <span className="ui-skel__col">
        <span className="ui-skel__block ui-skel__line" />
        <span className="ui-skel__block ui-skel__line ui-skel__line--half" />
      </span>
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cx("ui-skel2 ui-skel2--card", className)} aria-hidden="true">
      <span className="ui-skel__block ui-skel2__media ui-skel2__media--wide" />
      <span className="ui-skel__block ui-skel__line" />
      <span className="ui-skel__block ui-skel__line ui-skel__line--half" />
    </div>
  );
}

export function SkeletonTile({ className }: { className?: string }) {
  return (
    <div className={cx("ui-skel2 ui-skel2--tile", className)} aria-hidden="true">
      <span className="ui-skel__block ui-skel2__media ui-skel2__media--square" />
      <span className="ui-skel__block ui-skel__line" />
      <span className="ui-skel__block ui-skel__line ui-skel__line--half" />
    </div>
  );
}

export function SkeletonGroup({ children, label = "読み込んでいます", className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div className={cx("ui-skel2-group", className)} role="status" aria-busy="true" aria-live="polite">
      <span className="ui-sr">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonList({ count = 6, kind = "row", label, className }: { count?: number; kind?: "row" | "card" | "tile"; label?: string; className?: string }) {
  const n = Math.max(1, Math.min(count, 12));
  const Item = kind === "card" ? SkeletonCard : kind === "tile" ? SkeletonTile : SkeletonRow;
  return (
    <SkeletonGroup label={label} className={cx(kind !== "row" && "ui-skel2-group--grid", className)}>
      {Array.from({ length: n }, (_, index) => <Item key={index} />)}
    </SkeletonGroup>
  );
}
