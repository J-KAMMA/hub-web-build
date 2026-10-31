import "server-only";

import type { ThreadSummary } from "@/lib/domain";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listD1Threads } from "@/lib/server/d1-threads";

export interface BbsThreadsListData {
  threads: ThreadSummary[];
  total?: number;
  limit?: number;
  offset?: number;
}

export async function getBbsThreadsListData(
  boardKey?: string,
  limit = 50,
  offset = 0,
): Promise<BbsThreadsListData> {
  const database = getOptionalHubD1();
  if (database) {
    return { threads: await listD1Threads(database, boardKey, limit, offset) };
  }

  const { getThreads } = await import("@/lib/mock-data");
  return {
    threads: getThreads(boardKey).slice(offset, offset + limit),
  };
}
