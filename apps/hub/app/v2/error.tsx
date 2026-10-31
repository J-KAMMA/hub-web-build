"use client";

import { useEffect } from "react";

import { V2State } from "@/components/v2/v2-state";

import "./v2.css";

/*
 * /v2 配下で描画が失敗したときの画面。サーバーのデータを取り直せないので、外郭は出さず
 * 失敗の状態表示だけを v2 の面（.v2）の中に置く。再試行で同じ経路を描き直す。
 * 記録には digest だけ残し、本文や利用者のデータは書かない。
 */
export default function V2Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ event: "hub_v2_route_error", digest: error.digest ?? "unavailable" }));
  }, [error]);

  return (
    <div className="v2">
      <V2State
        kind="error"
        title="表示できませんでした"
        note="しばらくしてからもう一度お試しください。"
        action={{ label: "再試行", onClick: reset }}
        secondaryAction={{ label: "ホームへ", href: "/v2" }}
      />
    </div>
  );
}
