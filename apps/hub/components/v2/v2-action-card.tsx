import Link from "next/link";

import type { HubActionProjection } from "@/lib/action-layer";

/*
 * Action Card（2026-09-03、旦那様「ハブ全体の構想から分析して足りないものを作る」）。
 *
 * 構想（docs/HUB_SYSTEM_MAP.md 第2章）ではここが Hub の中心にある:
 *   投稿 → Action Card → 所有サービス → 購入・応募・実行・参加・閲覧 → 結果証明 → Hubへ戻る
 * 新しい主タブを増やすのではなく、投稿から各サービスの行動へ繋ぐ層が本体だという設計。
 * v2 の札は素のリンクのままで、この層が抜けていた。
 *
 * **Hub は正本を読まない。** 出すのは所有サービスが出した公開投影
 * （lib/action-layer.ts の HubActionProjection）だけ。値段も状態も投影の写しで、
 * 実際の操作は所有サービス側で作り直す。だから:
 *   - 投影が古くても、古い値段や停止済みの商品で取引を成立させない
 *   - 使えないときは押せない札にして、理由だけ出す
 *   - どのサービスの物か（ownerService）と投影の版を必ず持たせる
 */

const TYPE_LABELS: Record<string, { ja: string; en: string }> = {
  purchase: { ja: "購入", en: "Buy" },
  apply: { ja: "応募", en: "Apply" },
  accept_task: { ja: "引き受ける", en: "Accept" },
  execute_ai: { ja: "実行", en: "Run" },
  use_dataset: { ja: "データを使う", en: "Use data" },
  submit_compute: { ja: "計算を出す", en: "Submit" },
  join_research: { ja: "研究に参加", en: "Join" },
  view_listing: { ja: "掲載を見る", en: "View" },
  join_event: { ja: "参加", en: "Join" },
  purchase_gohotoken: { ja: "トークンを買う", en: "Buy token" },
  acquire_vault: { ja: "手に入れる", en: "Get" },
  read_hubpedia: { ja: "読む", en: "Read" },
};

const OWNER_LABELS: Record<string, string> = {
  commerce: "Commerce",
  hub: "Hub",
  ai: "AI",
  vault: "Vault",
  gohotoken: "GohoToken",
  hubpedia: "Hubpedia",
  data: "Data",
  compute: "Compute",
  research: "Research",
  listings: "Listings",
};

export function V2ActionCard({ action, japanese }: { action: HubActionProjection; japanese: boolean }) {
  const verb = TYPE_LABELS[action.type] ?? { ja: "開く", en: "Open" };
  const owner = OWNER_LABELS[action.ownerService] ?? action.ownerService;
  const usable = action.status === "available" && Boolean(action.href);

  const body = (
    <>
      {action.imageUrl ? (
        <span className="v2-hubaction__art">
          <img src={action.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        </span>
      ) : null}
      <span className="v2-hubaction__body">
        <span className="v2-hubaction__eyebrow">
          <span className="v2-badge">{action.label}</span>
          {action.priceLabel ? <strong>{action.priceLabel}</strong> : null}
        </span>
        <strong className="v2-hubaction__title">{action.title}</strong>
        {action.description ? <span className="v2-hubaction__note">{action.description}</span> : null}
        <span className="v2-hubaction__foot">
          {/* どのサービスの物かを必ず出す。Hub が持っているのは投影だけなので、行き先を偽らない。 */}
          <small>{owner}</small>
          <span className="v2-hubaction__go">
            {usable
              ? (japanese ? `${verb.ja}へ進む` : `${verb.en}`)
              : action.statusLabel ?? (japanese ? "いまは使えません" : "Unavailable")}
          </span>
        </span>
      </span>
    </>
  );

  if (!usable) {
    return (
      <section className="v2-hubaction v2-hubaction--off" aria-disabled="true">
        {body}
      </section>
    );
  }

  const internal = action.href!.startsWith("/");
  const attributes = {
    className: "v2-hubaction",
    "data-action-type": action.type,
    "data-owner-service": action.ownerService,
    "data-projection-version": action.projectionVersion,
  };

  return internal
    ? <Link href={action.href!} {...attributes}>{body}</Link>
    : <a href={action.href!} target="_blank" rel="noopener noreferrer nofollow ugc" {...attributes}>{body}</a>;
}
