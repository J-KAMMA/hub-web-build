import { V2Skeleton } from "@/components/v2/v2-skeleton";

import "../v2.css";

/* ゲームの一覧が描かれるまでの表示。絵の格子の骨組み（列は作らない。本物の列が来たときに位置が跳ぶ）。 */
export default function V2GamesLoading() {
  return (
    <div className="v2">
      <div className="v2-loading"><V2Skeleton kind="tiles" count={8} /></div>
    </div>
  );
}
