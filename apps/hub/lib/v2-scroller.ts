/*
 * v2 はスクロールするのが文書そのもの（2026-10-14）。#hub-main は data-scroll="document" を持ち、
 * 自分ではスクロールしない。位置の保存・復元はこの関数で「いま実際に動く要素」を得る。
 * data-scroll の無い #hub-main（既存の外郭）は従来どおり枠自身が動く。
 */
export function scrollerFor(from: Element | null | undefined): Element | null {
  const main = from?.closest<HTMLElement>("#hub-main") ?? null;
  if (main && main.dataset.scroll !== "document") return main;
  return document.scrollingElement;
}

/* scroll イベントの受け手。文書のスクロールは window に届く。 */
export function scrollEventTarget(scroller: Element | null): EventTarget | null {
  return scroller && scroller === document.scrollingElement ? window : scroller;
}
