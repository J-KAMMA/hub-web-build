"use client";

import { useEffect, useRef, useState } from "react";

/*
 * 規約・方針の目次（v2 だけ）。本文は変えず、すでにある h2 を読んで並べる。
 * h2 に id が無ければここで付ける（本文の React 要素は id を持たないので衝突しない）。
 * 幅が足りない画面は CSS で隠す。
 */
export function LegalToc() {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    const root = ref.current?.closest(".hub-legal");
    if (!root) return;
    const next: { id: string; label: string }[] = [];
    root.querySelectorAll<HTMLHeadingElement>(":scope > section > h2").forEach((heading, index) => {
      if (!heading.id) heading.id = `legal-s${index + 1}`;
      const label = heading.textContent?.trim();
      if (label) next.push({ id: heading.id, label });
    });
    setItems(next);
  }, []);

  if (items.length < 3) return <nav ref={ref} aria-hidden hidden />;
  return (
    <nav ref={ref} className="hub-legal__toc" aria-label="目次">
      <ol>
        {items.map((item) => (
          <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>
        ))}
      </ol>
    </nav>
  );
}
