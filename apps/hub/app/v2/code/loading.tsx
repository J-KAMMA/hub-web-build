import { V2Skeleton } from "@/components/v2/v2-skeleton";

import "../v2.css";

/* コードの画面が描かれるまでの表示。リポジトリの行の骨組み。 */
export default function V2CodeLoading() {
  return (
    <div className="v2">
      <div className="v2-loading"><V2Skeleton kind="lines" count={6} /></div>
    </div>
  );
}
