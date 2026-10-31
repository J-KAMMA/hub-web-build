import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "./cx";

/*
 * Chip (SPEC 3): height 32, pill, 13/600. Selected inverts to --text on --bg;
 * unselected sits on --interactive. Selection is neutral, never --action.
 * Renders a link when href is given, otherwise a toggle button (aria-pressed).
 */
type ChipBase = { children: ReactNode; selected?: boolean; className?: string };

export type ChipProps =
  | (ChipBase & { href: string; onClick?: undefined })
  | (ChipBase & { href?: undefined; onClick?: () => void });

export function Chip({ children, selected = false, className, href, onClick }: ChipProps) {
  const cls = cx("ui-chip", selected && "ui-chip--selected", className);
  if (href !== undefined) {
    return (
      <Link className={cls} href={href} aria-current={selected ? "page" : undefined}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}

/** Horizontal chip row that scrolls sideways with a fade at the edges. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="ui-chip-row" role="group" aria-label={label}>
      {children}
    </div>
  );
}
