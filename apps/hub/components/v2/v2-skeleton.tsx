/*
 * 読み込み中の骨組み（2026-09-03、旦那様「ほかにuiでやることは」→「やって」の3手目）。
 * 「読み込んでいます…」の1行だと、来た瞬間に画面が跳ねる。来るものと同じ形の
 * 灰色の枠を先に置き、跳ねを無くす。
 *
 *   rows   投稿の行（顔・名前・本文2行）。フィード・返信・通知・人の一覧
 *   tiles  絵が上の札の格子。記事・動画・音楽・商品
 *   lines  文だけ。設定・ウォレットなどの表
 *
 * "use client" を付けない。サーバーの loading.tsx からもクライアントからも使う。
 * 読み上げには「読み込んでいます」を1回だけ伝える（aria-busy と status）。
 */
import { Skeleton } from "@/components/v2/ui/skeleton";

export function V2Skeleton({ kind = "rows", count = 3, japanese = true }: { kind?: "rows" | "tiles" | "lines"; count?: number; japanese?: boolean }) {
  /* 投稿の行は完成形と同じ寸法の部品（顔40・名前行・本文・操作行36）に任せる。 */
  if (kind === "rows") return <Skeleton kind="post" count={count} label={japanese ? "読み込んでいます" : "Loading"} />;
  const items = Array.from({ length: Math.max(1, Math.min(count, 12)) }, (_, index) => index);
  return (
    <div className={`v2-skeleton v2-skeleton--${kind}`} role="status" aria-busy="true" aria-live="polite">
      <span className="v2-sr">{japanese ? "読み込んでいます" : "Loading"}</span>
      {items.map((index) => (
        kind === "tiles" ? (
          <div key={index} className="v2-skeleton__tile" aria-hidden="true">
            <span className="v2-skeleton__art" />
            <span className="v2-skeleton__bar" />
            <span className="v2-skeleton__bar v2-skeleton__bar--short" />
          </div>
        ) : kind === "lines" ? (
          <span key={index} className="v2-skeleton__bar" aria-hidden="true" style={{ width: `${88 - (index % 3) * 18}%` }} />
        ) : (
          <div key={index} className="v2-skeleton__row" aria-hidden="true">
            <span className="v2-skeleton__avatar" />
            <span className="v2-skeleton__body">
              <span className="v2-skeleton__bar v2-skeleton__bar--short" />
              <span className="v2-skeleton__bar" />
              <span className="v2-skeleton__bar v2-skeleton__bar--half" />
            </span>
          </div>
        )
      ))}
    </div>
  );
}
