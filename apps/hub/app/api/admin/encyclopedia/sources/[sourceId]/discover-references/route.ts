import { NextResponse } from "next/server";

import { apiError, requireAdmin } from "@/lib/encyclopedia/admin";
import { getEncyclopediaConfig } from "@/lib/encyclopedia/config";
import { fetchSource } from "@/lib/encyclopedia/fetch";
import { getSource } from "@/lib/encyclopedia/repository";
import { isWikipediaResearchGateway } from "@/lib/encyclopedia/source-license-policy";
import { extractWikipediaReferenceCandidates } from "@/lib/encyclopedia/wikipedia-research";

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const source = await getSource((await params).sourceId);
    if (!source) return NextResponse.json({ error: { code: "not_found", message: "Source not found." } }, { status: 404 });
    if (!isWikipediaResearchGateway(source)) {
      return NextResponse.json({ error: { code: "invalid_source_role", message: "Only Wikipedia research gateways support reference discovery." } }, { status: 422 });
    }
    const config = getEncyclopediaConfig();
    const fetched = await fetchSource(source.url, {
      timeoutMs: config.ENCYCLOPEDIA_FETCH_TIMEOUT_MS,
      maxBytes: config.ENCYCLOPEDIA_MAX_SOURCE_BYTES,
    });
    const references = extractWikipediaReferenceCandidates(new TextDecoder().decode(fetched.bytes), fetched.finalUrl);
    return NextResponse.json({
      sourceId: source.id,
      role: "discovery-only",
      mayBeCited: false,
      references,
    });
  } catch (error) {
    return apiError(error);
  }
}
