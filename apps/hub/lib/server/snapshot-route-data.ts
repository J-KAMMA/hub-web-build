import "server-only";

import { getSnapshot } from "@/lib/mock-data";

type SnapshotData = ReturnType<typeof getSnapshot>;

export function getSnapshotRouteData(): SnapshotData {
  return getSnapshot();
}
