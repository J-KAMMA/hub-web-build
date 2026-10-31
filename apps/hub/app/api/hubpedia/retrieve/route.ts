import { NextResponse } from "next/server";
import { getHubD1, getOptionalHubLedgerObjects } from "@/lib/server/hub-d1";
import { clampLimit, MAX_QUERY_CHARS, retrieveForQuestion, RETRIEVE_VERSION, type RetrievedItem } from "@/lib/encyclopedia/retrieval";
import { enforceMcpRateLimit, rateHeaders } from "@/lib/server/hubpedia-mcp-public";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

/*
 * Public retrieval for "ask Hubpedia" (versioned: {version:1, items}). Called server-to-server by the AI Worker.
 * The question is never logged, stored, counted or sent to search-event tables. Fails closed to an empty list.
 */
const TIMEOUT_MS = 2500;
const HEADERS = { "x-content-type-options": "nosniff" } as const;

const empty = (extra: Record<string, string> = {}) => NextResponse.json({ version: RETRIEVE_VERSION, items: [] as RetrievedItem[] }, { headers: { ...HEADERS, "cache-control": "private, no-store", ...extra } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").normalize("NFKC").trim().slice(0, MAX_QUERY_CHARS);
  const limit = clampLimit(url.searchParams.get("limit"));
  if (!query) return empty();
  try {
    const db = getHubD1();
    const rate = await enforceMcpRateLimit(db, request, "search");
    if (!rate.allowed) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { ...HEADERS, ...rateHeaders(rate), "cache-control": "private, no-store" } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const items = await Promise.race([
      retrieveForQuestion(db, getOptionalHubLedgerObjects(), query, limit),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    if (items === null) return empty(rateHeaders(rate));
    return NextResponse.json({ version: RETRIEVE_VERSION, items }, { headers: { ...HEADERS, ...publicApiCacheHeaders(request, "hubpedia.retrieve"), ...rateHeaders(rate) } });
  } catch {
    return empty();
  }
}
