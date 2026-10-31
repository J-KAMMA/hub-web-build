"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import { V2Icon } from "@/components/v2/v2-icons";

/* 帯の「…」。主操作を1つに絞り、二次の入口（スタジオ・下書き・統計など）はここへ置く。 */
export function V2MoreMenu({ items, label }: { items: { href: string; label: string }[]; label: string }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  return (
    <>
      <button type="button" className="v2-music-menu__trigger" popoverTarget={id} aria-label={label} title={label}
        onClick={(event) => { const r = event.currentTarget.getBoundingClientRect(); setPosition({ left: Math.max(8, Math.min(r.right - 200, window.innerWidth - 208)), top: r.bottom + 4 }); }}>
        <V2Icon name="more" />
      </button>
      <div ref={menu} id={id} popover="auto" className="v2-music-menu" style={position}>
        {items.map((item) => <Link key={item.href} href={item.href} onClick={() => menu.current?.hidePopover()}>{item.label}</Link>)}
      </div>
    </>
  );
}
