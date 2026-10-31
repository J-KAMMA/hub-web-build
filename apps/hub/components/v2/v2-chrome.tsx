"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type RefObject } from "react";

import { Sheet } from "@/components/v2/ui";
import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import { isCurrent } from "@/lib/v2-nav-current";

/*
 * 帯の隠れ・出現と、携帯のメニュー（2026-10-14、SPEC 4.1）。
 *
 * 文書そのものがスクロールするので、帯の隠れは window の scroll で決める。
 * 下へ送ると隠れ、上へ 8px 戻すと出る。隠れる・出るは frame の data-chrome だけで
 * 表し、実際の動きは v2-shell.css が `transform` で受け持つ（高さは変えない＝CLS 0）。
 * 机上幅では隠さない（CSS が data-chrome を見ない）。
 */

const HIDE_AFTER = 72;
const SHOW_DELTA = 8;

export function useScrollChrome(frame: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    let last = window.scrollY;
    let hidden = false;
    let scrolled = false;
    let ticking = false;
    const apply = () => {
      ticking = false;
      const y = Math.max(0, window.scrollY);
      const delta = y - last;
      const nextScrolled = y > 2;
      if (nextScrolled !== scrolled) {
        scrolled = nextScrolled;
        node.dataset.scrolled = scrolled ? "true" : "false";
      }
      let nextHidden = hidden;
      if (y <= HIDE_AFTER) nextHidden = false;
      else if (delta > 0) nextHidden = true;
      else if (delta < -SHOW_DELTA) nextHidden = false;
      /* 8px 未満の戻りは位置を更新しない（小さな揺れで出入りさせない）。 */
      if (delta > 0 || delta < -SHOW_DELTA || y <= HIDE_AFTER) last = y;
      if (nextHidden !== hidden) {
        hidden = nextHidden;
        node.dataset.chrome = hidden ? "hidden" : "shown";
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(apply);
    };
    node.dataset.chrome = "shown";
    node.dataset.scrolled = window.scrollY > 2 ? "true" : "false";
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [frame]);
}

export type V2MenuItem = {
  href: string;
  label: string;
  icon?: V2IconName;
};

export type V2MenuConfig = {
  items: V2MenuItem[];
  currentPath: string;
  title: string;
  close: string;
};

type ChromeValue = { openMenu: () => void; label: string } | null;
const ChromeContext = createContext<ChromeValue>(null);

export function V2ChromeProvider({ menu, children }: { menu?: V2MenuConfig; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openMenu = useCallback(() => setOpen(true), []);
  return (
    <ChromeContext.Provider value={menu ? { openMenu, label: menu.title } : null}>
      {children}
      {menu ? (
        <Sheet open={open} onClose={() => setOpen(false)} title={menu.title} className="v2-menu-sheet">
          <nav aria-label={menu.title}>
            <ul className="v2-menu-sheet__list">
              {menu.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="v2-menu-sheet__item"
                    aria-current={isCurrent(item.href, menu.currentPath) ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.icon ? <V2Icon name={item.icon} className="v2-menu-sheet__icon" /> : null}
                    <span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Sheet>
      ) : null}
    </ChromeContext.Provider>
  );
}

/* 携帯だけに見える、帯の左端のメニュー（CSS が机上で隠す）。ナビの縦の帯の代わり。 */
export function V2MenuTrigger() {
  const chrome = useContext(ChromeContext);
  if (!chrome) return null;
  return (
    <button type="button" className="v2-menu-trigger" aria-haspopup="dialog" aria-label={chrome.label} onClick={chrome.openMenu}>
      <V2Icon name="menu" className="v2-menu-trigger__mark" />
    </button>
  );
}

/*
 * 携帯の新規投稿の丸（右下 56px、下のタブの上 16px）。机上では CSS が隠す。
 * 動きは n キーと同じ: 投稿欄があればそこへ、無ければ投稿欄のあるタイムラインへ。
 */
export function V2ComposeFab({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="v2-fab"
      aria-label={label}
      onClick={() => {
        const compose = document.querySelector<HTMLTextAreaElement>("#compose textarea");
        if (compose) { compose.focus(); compose.scrollIntoView({ block: "center" }); } else router.push("/v2#compose");
      }}
    >
      <V2Icon name="compose" className="v2-fab__mark" />
    </button>
  );
}
