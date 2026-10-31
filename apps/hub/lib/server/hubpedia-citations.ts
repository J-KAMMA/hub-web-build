import "server-only";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listArticlesCitingHubItem, type HubEvidenceKind, type HubItemCitation } from "@/lib/server/hubpedia-hub-evidence";

/**
 * Backlinks for a Hub item page (DESIGN.md section 8): the same read the public
 * citations API performs, called in-process so the page makes no extra request.
 * Published, approved entries only; an item that may not be material lists
 * nothing. Any failure shows nothing rather than breaking the page.
 */
export async function loadHubItemCitations(kind: HubEvidenceKind, id: string | null | undefined): Promise<HubItemCitation[]> {
  if (!id) return [];
  try {
    const database = getOptionalHubD1();
    return database ? await listArticlesCitingHubItem(database, kind, id) : [];
  } catch {
    return [];
  }
}

/** A research page shows one version at a time (?document=&version=); its citations key on that revision row. */
export async function loadResearchVersionCitations(documentId: string | undefined, version: string | undefined): Promise<HubItemCitation[]> {
  if (!documentId || !version || !/^[1-9][0-9]{0,8}$/.test(version) || documentId.length > 128) return [];
  try {
    const database = getOptionalHubD1();
    if (!database) return [];
    const row = await database
      .prepare("SELECT id FROM research_document_revisions WHERE document_id = ? AND version = ?")
      .bind(documentId, Number(version))
      .first<{ id: string }>();
    return row ? await listArticlesCitingHubItem(database, "research_version", row.id) : [];
  } catch {
    return [];
  }
}
