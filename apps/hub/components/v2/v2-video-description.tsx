"use client";

import { useId, useState, type ReactNode } from "react";

/*
 * 視聴ページの説明の箱（SPEC 4.5）。1行目に回数・日付、本文は3行で省略して
 * 「もっと見る」で開く。タグ（話題へのリンク）は開いたときに出す。
 */
export function V2VideoDescription({ stats, children, tags, locale }: {
  stats: ReactNode;
  children: ReactNode;
  tags?: ReactNode;
  locale: string;
}) {
  const ja = locale === "ja";
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="v2-watch__desc" aria-label={ja ? "説明" : "Description"}>
      <p className="v2-watch__desc-stats">{stats}</p>
      <div id={id} className="v2-watch__desc-body" data-open={open}>{children}</div>
      {open && tags ? tags : null}
      <button type="button" className="v2-watch__desc-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {open ? (ja ? "一部を表示" : "Show less") : (ja ? "もっと見る" : "Show more")}
      </button>
    </section>
  );
}
