import Link from "next/link";

import { tagHref, type TagChipKind } from "@/lib/tag-href";

import { cx } from "./ui/cx";

/*
 * The single tag chip. Always links to the canonical tag page via tagHref().
 * Placement: cards show one row below title/meta, max 3 + "+N"; detail pages show
 * the full row (max 8) directly under the title block.
 */
export function V2TagChip({ tag, kind, size = "md", className }: { tag: string; kind?: TagChipKind; size?: "sm" | "md"; className?: string }) {
  const display = tag.trim().replace(/^[#＃]+/u, "");
  if (!display) return null;
  return (
    <Link className={cx("v2-tag-chip", size === "sm" && "v2-tag-chip--sm", className)} href={tagHref(display, kind)}>
      #{display}
    </Link>
  );
}

export function V2TagChipRow({
  tags,
  kind,
  max = 8,
  size = "md",
  label,
  className,
}: {
  tags: readonly string[] | undefined;
  kind?: TagChipKind;
  max?: number;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const seen = new Set<string>();
  const list = (tags ?? []).map((tag) => tag.trim().replace(/^[#＃]+/u, "")).filter((tag) => {
    if (!tag || seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
  if (!list.length) return null;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <ul className={cx("v2-tag-chips", className)} aria-label={label}>
      {shown.map((tag) => <li key={tag}><V2TagChip tag={tag} kind={kind} size={size} /></li>)}
      {rest > 0 ? <li><span className={cx("v2-tag-chip v2-tag-chip--more", size === "sm" && "v2-tag-chip--sm")}>+{rest}</span></li> : null}
    </ul>
  );
}
