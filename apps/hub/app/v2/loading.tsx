import { V2Skeleton } from "@/components/v2/v2-skeleton";

import "./v2.css";

/*
 * /v2 のどの画面でも、行き先が届くまでの間に出る骨組み（2026-10-30、監査 S1）。
 * 画面ごとの loading.tsx（code・games）が無い画面はこれが受ける。
 * 上端の細い棒は CSS だけで動くので、JS の読み込みを待たずに「押した」が見える。
 */
export default function V2Loading() {
  return (
    <div className="v2">
      <div className="v2-progress v2-progress--on" aria-hidden="true" />
      <div className="v2-loading" aria-busy="true">
        <V2Skeleton kind="rows" count={4} />
      </div>
    </div>
  );
}
