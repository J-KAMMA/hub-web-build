"use client";

import type { PublicAccessGate } from "@/lib/access-gates/types";

import { gohoTokenPurchaseForGate } from "@/components/v2/v2-gate-gohotoken-purchase";

/* 一覧用の「鍵つき」表示。何が要るか・どこで手に入るかを1行で示す。通信はしない（トークン名は引かない）。
   価格は出さない。Hub が売るとも書かない。入手の案内は作成者が付けたものと GohoToken の購入口だけ。 */

export function gateBadgeHint(gate: PublicAccessGate, japanese: boolean): { description: string; howTo: string } {
  const description = gate.description.trim();
  const goho = gohoTokenPurchaseForGate(gate) !== null;
  const howTo = goho
    ? (japanese ? "GohoTokenで入手できます" : "Available from GohoToken")
    : gate.acquisitionUrl
      ? (japanese ? "入手先あり" : "Where to get it is linked")
      : "";
  return { description, howTo };
}

export function V2GateBadge({ gate, japanese = true, className }: { gate: PublicAccessGate; japanese?: boolean; className?: string }) {
  const { description, howTo } = gateBadgeHint(gate, japanese);
  return (
    <span className={className ? `v2-gate-badge ${className}` : "v2-gate-badge"}>
      <span className="v2-gate-badge__mark"><svg className="v2-gate-badge__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.5" d="M4 7V5a4 4 0 0 1 8 0v2M3 7h10v7H3z" /></svg>{japanese ? "鍵つき" : "Locked"}</span>
      {description ? <span className="v2-gate-badge__line">{description}</span> : null}
      {howTo ? <span className="v2-gate-badge__how">{howTo}</span> : null}
    </span>
  );
}
