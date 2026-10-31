import { V2TagChipRow } from "@/components/v2/v2-tag-chip";
import type { ReactNode } from "react";

/*
 * 詳細画面の型（2026-09-03、旦那様「詳細画面の型を1つ作って4つに当てる」）。
 * 参考は apps/adult-affiliate の作品ページ: 大きな絵 → 行き先のボタン → 短い本文 →
 * リンク付きのタグ → 同じタグの札。記事・動画・商品がこの順で並ぶ。
 *
 * 絵は切り抜かない（contain）。縦横比は渡す側が決める。
 * 見出しは列の頭の h1 が持つ。ここでは題を p で繰り返す（頭は1行で省略するため）。
 */
export function V2Detail({
  media,
  mediaRatio = "16 / 9",
  title,
  meta,
  action,
  lead,
  tags,
  children,
}: {
  media?: ReactNode;
  mediaRatio?: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  lead?: ReactNode;
  tags?: { label: string; href: string }[];
  children?: ReactNode;
}) {
  return (
    <article className="v2-detail">
      {media ? <div className="v2-detail__media" style={{ aspectRatio: mediaRatio }}>{media}</div> : null}
      <p className="v2-detail__title">{title}</p>
      {meta ? <p className="v2-detail__meta">{meta}</p> : null}
      {action ? <div className="v2-detail__actions">{action}</div> : null}
      {lead ? <div className="v2-detail__lead">{lead}</div> : null}
      {tags?.length ? (
        <V2TagChipRow className="v2-detail__tags" tags={tags.map((tag) => tag.label)} />
      ) : null}
      {children}
    </article>
  );
}

/* 詳細の下に置く区画。「同じタグの作品」「購入先と価格」など。 */
export function V2DetailSection({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="v2-msec">
      <header className="v2-msec__head">
        <h2 className="v2-column__title v2-column__title--section">{title}</h2>
        {note ? <span className="v2-msec__note">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}
