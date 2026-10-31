import { redirect } from "next/navigation";

import { buildBoardCatalog, normalizeBoardKey } from "@/lib/bbs-board-catalog";
import { normalizeThreadTags } from "@/lib/thread-tags";

export default async function LegacyBoardPage({ params }: { params: Promise<{ boardKey: string }> }) {
  const { boardKey } = await params;
  const board = buildBoardCatalog().find((item) => normalizeBoardKey(item.key) === normalizeBoardKey(boardKey));
  const legacyTag = board ? normalizeThreadTags([board.title])[0] : undefined;
  redirect(legacyTag ? `/v2/bbs?tag=${encodeURIComponent(legacyTag)}` : "/v2/bbs");
}
