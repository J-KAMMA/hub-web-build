import { V2Skeleton } from "@/components/v2/v2-skeleton";

import "@/app/v2/v2.css";

/*
 * 一覧・索引の画面が届くまでの骨組み（2026-11-01）。
 * 以前は app/v2/loading.tsx が全経路を Suspense で包み、notFound() が呼ばれる前に
 * ステータスが 200 で確定していた。いまは notFound() を呼ばない一覧画面だけが
 * (list) / (home) ルートグループ内の loading.tsx でこれを使う。詳細画面と捕捉経路は
 * 境界を持たないので 404 が本当の 404 で返る。上端の棒は CSS だけで動く。
 */
export function V2ListLoading() {
  return (
    <div className="v2">
      <div className="v2-progress v2-progress--on" aria-hidden="true" />
      <div className="v2-loading" aria-busy="true">
        <V2Skeleton kind="rows" count={4} />
      </div>
    </div>
  );
}
