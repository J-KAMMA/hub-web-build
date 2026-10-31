import { listArticleStructure } from "@/lib/server/hubpedia-wiki-annotations";
import { wikiRoute } from "@/lib/server/hubpedia-wiki-http";

/* Public. -> { slug, paragraphs: [{id, index, text, discussionCount}],
   claims: [{id, statement, status, knowledgeStatus, discussionCount, hubEvidence: [{kind, itemId, stance, quote, status}]}] } */
export const GET = wikiRoute<{ slug: string }>({ auth: false }, async ({ db, params }) => listArticleStructure(db, params.slug));
