import { NextResponse } from "next/server";
import { requireAdmin, apiError } from "@/lib/encyclopedia/admin";
import { getHubD1 } from "@/lib/server/hub-d1";
import { backfillStructuredKnowledge, claimRepairBatch, getAutomationControl, getHubpediaOperationsSnapshot, setAutomationControl } from "@/lib/server/hubpedia-quality-operations";
import { enqueueRepair, saveArticleAudit } from "@/lib/server/hubpedia-quality-operations";
import { getPublicReaderReadySeedArticles } from "@/lib/encyclopedia/public-seed";
import { publicationGate } from "@/lib/encyclopedia/publication-operations";
import { enqueueHubpediaCategoryRefresh, synchronizeHubpediaCategoryRegistry } from "@/lib/server/hubpedia-category-registry";

export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const db = getHubD1();
    const PUBLIC_READER_READY_SEED_ARTICLES = await getPublicReaderReadySeedArticles();
    const [control, snapshot, queue, licenses, searches] = await Promise.all([
      getAutomationControl(db),
      getHubpediaOperationsSnapshot(db,PUBLIC_READER_READY_SEED_ARTICLES.length),
      db.prepare(`SELECT article_slug articleSlug,reason_code reasonCode,priority,status,attempt_count attemptCount,updated_at updatedAt FROM hubpedia_repair_queue ORDER BY priority DESC,created_at LIMIT 100`).all(),
      db.prepare(`SELECT source_host sourceHost,license_name licenseName,reuse_status reuseStatus,reviewed_at reviewedAt FROM hubpedia_source_license_registry ORDER BY source_host`).all(),
      db.prepare(`SELECT normalized_query query,count(*) searches,sum(CASE WHEN outcome='clicked' THEN 1 ELSE 0 END) clicks FROM hubpedia_search_events GROUP BY query_hash,normalized_query ORDER BY searches DESC LIMIT 50`).all(),
    ]);
    return NextResponse.json({ control, snapshot, queue: queue.results ?? [], licenses: licenses.results ?? [], searches: searches.results ?? [] });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const body = await request.json() as { enabled?: unknown; reason?: unknown };
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: { code: "invalid_input", message: "enabled must be boolean." } }, { status: 400 });
    return NextResponse.json({ control: await setAutomationControl(getHubD1(), body.enabled, typeof body.reason === "string" ? body.reason : null) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({})) as { limit?: unknown; action?: unknown; categoryId?: unknown; reason?: unknown; priority?: unknown };
    const db = getHubD1();
    if(body.action === "migrate-seeds" || body.action === "reevaluate-migrated") {
      return NextResponse.json({
        error: {
          code: "offline_seed_operation",
          message: "Bulk Hubpedia seed operations run through the offline import workflow.",
        },
      }, { status: 410 });
    }
    if(body.action === "backfill-knowledge")return NextResponse.json({knowledge:await backfillStructuredKnowledge(db,typeof body.limit==="number"?body.limit:1)});
    if(body.action === "synchronize-categories")return NextResponse.json({categories:await synchronizeHubpediaCategoryRegistry(db,await getPublicReaderReadySeedArticles())});
    if(body.action === "refresh-category"){
      if(typeof body.categoryId!=="string")return NextResponse.json({error:{code:"invalid_input",message:"categoryId is required."}},{status:400});
      const queued=await enqueueHubpediaCategoryRefresh(db,body.categoryId,typeof body.reason==="string"?body.reason:"Category-scoped refresh",typeof body.priority==="number"?body.priority:50);
      return queued?NextResponse.json({refresh:queued},{status:202}):NextResponse.json({error:{code:"not_found",message:"Category not found."}},{status:404});
    }
    if (body.action === "audit") {
      let queued = 0;
      const PUBLIC_READER_READY_SEED_ARTICLES = await getPublicReaderReadySeedArticles();
      for (const article of PUBLIC_READER_READY_SEED_ARTICLES) {
        const gate = publicationGate(article, PUBLIC_READER_READY_SEED_ARTICLES);
        await saveArticleAudit(db, { slug: article.slug, revisionKey: `seed:${article.slug}`, score: gate.score, publishable: gate.publishable, blockers: gate.blockers, changeReason: "Scheduled publication audit" });
        if (!gate.publishable) {
          await enqueueRepair(db, { slug: article.slug, reasonCode: gate.blockers[0]?.code ?? "quality", priority: 100 - gate.score, assessment: gate });
          queued += 1;
        }
      }
      return NextResponse.json({ audited: PUBLIC_READER_READY_SEED_ARTICLES.length, queued });
    }
    return NextResponse.json({ repairs: await claimRepairBatch(db, typeof body.limit === "number" ? body.limit : 5) });
  } catch (error) { return apiError(error); }
}
