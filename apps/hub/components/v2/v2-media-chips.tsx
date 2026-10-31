"use client";

import { useEffect, useRef, useState } from "react";

import { Chip } from "@/components/v2/ui/chip";
import { V2Icon } from "@/components/v2/v2-icons";
import "@/app/v2/v2-media-column.css";

/*
 * 本文の上の横一列のチップ（すべて・分類・フォロー中のタグ）。選択中は反転。
 * 溢れたら右に › を、左へ戻れるときは ‹ を出す（Hub Desktop と同じ）。
 */
export type V2MediaChip = { key: string; label: string; href: string; selected: boolean; className?: string };

export function V2MediaChips({ label, chips, japanese = true }: { label: string; chips: V2MediaChip[]; japanese?: boolean }) {
  const track = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ back: false, next: false });

  useEffect(() => {
    const node = track.current?.querySelector<HTMLElement>(".ui-chip-row");
    if (!node) return;
    const sync = () => {
      const max = node.scrollWidth - node.clientWidth;
      setEdges({ back: node.scrollLeft > 1, next: max > 1 && node.scrollLeft < max - 1 });
    };
    sync();
    node.addEventListener("scroll", sync, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    observer?.observe(node);
    return () => { node.removeEventListener("scroll", sync); observer?.disconnect(); };
  }, [chips.length]);

  if (!chips.length) return null;
  const step = (direction: 1 | -1) => {
    const node = track.current?.querySelector<HTMLElement>(".ui-chip-row");
    node?.scrollBy({ left: direction * Math.max(120, node.clientWidth * 0.8), behavior: "smooth" });
  };
  return (
    <div className="v2-mc-chips" ref={track}>
      <button type="button" className="v2-mc-chips__step" hidden={!edges.back} aria-label={japanese ? "左へ戻す" : "Scroll left"} onClick={() => step(-1)}>
        <V2Icon name="chevron-left" />
      </button>
      <div className="ui-chip-row" role="group" aria-label={label}>
        {chips.map((chip) => <Chip key={chip.key} href={chip.href} selected={chip.selected} className={chip.className}>{chip.label}</Chip>)}
      </div>
      <button type="button" className="v2-mc-chips__step" hidden={!edges.next} aria-label={japanese ? "右へ送る" : "Scroll right"} onClick={() => step(1)}>
        <V2Icon name="chevron-right" />
      </button>
    </div>
  );
}
