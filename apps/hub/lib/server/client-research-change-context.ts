import "server-only";

import { normalizeHubOrigin } from "@/lib/hub-network-client";
import { researchForkDigest } from "@/lib/research-fork-package";
import { getHubD1, HubD1UnavailableError } from "./hub-d1";
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from "./desktop-hub-auth";
import { HubSuspendedError } from "./hub-session";
import { hasSameOrigin } from "./hub-auth-route";
import { readResearchDocument, ResearchWorkspaceError } from "./research-workspace";

export type ResearchChangeContext = {
  viewerId: string; projectId: string; documentId: string; version: number; body: string; contentHash: string;
  source: { origin: string; projectId: string; documentId: string; baseVersion: number; baseHash: string };
};
type Mapping = { sourceId: string; documentId: string; version: number; contentHash: string };
const RESPONSE_BYTES = 1024 * 1024;
const SOURCE_BYTES = 64 * 1024;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const projectId = (value: unknown): value is string => typeof value === "string" && value.length === 35 && /^rp_[a-f0-9]{32}$/.test(value);
const documentId = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 100 && !/[^A-Za-z0-9_.-]/.test(value);
const viewerId = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value);
const version = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const sha = (value: unknown): value is string => typeof value === "string" && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const wellFormed = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

class ChangeContextError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const invalid = (): never => { throw new ChangeContextError("invalid_request", 400); };
const unavailable = (): never => { throw new ChangeContextError("research_change_context_unavailable", 503); };
const notFound = (): never => { throw new ChangeContextError("research_change_context_not_found", 404); };
function json(value: unknown, status = 200): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > RESPONSE_BYTES) return json({ error: "research_change_context_unavailable" }, 503);
  return new Response(body, { status, headers: { ...headers, "Content-Type": "application/json" } });
}
function closed(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return unavailable();
  return record;
}

function sourceMapping(raw: string, selectedId: string): ResearchChangeContext["source"] {
  let decoded: unknown; try { decoded = JSON.parse(raw); } catch { return unavailable(); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return unavailable();
  const value = (decoded as Record<string, unknown>).source;
  if (value === undefined || value === null) return notFound();
  const source = closed(value, ["projectId", "href", "title", "snapshotHash", "documents"]);
  if (!projectId(source.projectId) || typeof source.href !== "string" || source.href.length > 600
    || typeof source.title !== "string" || source.title.length > 240 || !wellFormed(source.title)
    || !sha(source.snapshotHash) || !Array.isArray(source.documents) || source.documents.length > 20) return unavailable();
  let origin: string;
  try { const url = new URL(source.href); origin = normalizeHubOrigin(url.origin); }
  catch { return unavailable(); }
  if (source.href !== `${origin}/v2/research/${source.projectId}`) return unavailable();
  const originalIds = new Set<string>(), localIds = new Set<string>();
  const mappings: Mapping[] = source.documents.map(value => {
    const entry = closed(value, ["sourceId", "documentId", "version", "contentHash"]);
    if (!documentId(entry.sourceId) || !documentId(entry.documentId) || !version(entry.version) || !sha(entry.contentHash)
      || originalIds.has(entry.sourceId) || localIds.has(entry.documentId)) return unavailable();
    originalIds.add(entry.sourceId); localIds.add(entry.documentId);
    return { sourceId: entry.sourceId, documentId: entry.documentId, version: entry.version, contentHash: entry.contentHash };
  });
  const mapping = mappings.find(entry => entry.documentId === selectedId) ?? notFound();
  return { origin, projectId: source.projectId, documentId: mapping.sourceId, baseVersion: mapping.version, baseHash: mapping.contentHash };
}

export async function clientResearchChangeContext(request: Request, localProjectId: string) {
  try {
    if (request.method !== "GET" || request.body !== null || request.url.length > 2048 || !projectId(localProjectId)) return invalid();
    const url = new URL(request.url), keys = [...url.searchParams.keys()];
    if (keys.length !== 2 || keys.some(key => key !== "documentId" && key !== "version")
      || url.searchParams.getAll("documentId").length !== 1 || url.searchParams.getAll("version").length !== 1) return invalid();
    const selectedId = url.searchParams.get("documentId"), selectedVersion = url.searchParams.get("version");
    if (!documentId(selectedId) || !selectedVersion || !/^[1-9]\d{0,15}$/.test(selectedVersion)
      || !version(Number(selectedVersion)) || String(Number(selectedVersion)) !== selectedVersion) return invalid();
    const expected = request.headers.get("X-Hub-Expected-Viewer");
    if (expected !== null && !viewerId(expected)) return invalid();
    if (request.headers.has("origin") && !hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    if (!viewerId(viewer.id)) return unavailable();
    if (expected !== null && viewer.id !== expected) return json({ error: "research_change_context_changed" }, 409);
    // Actual project/document access is rechecked by the existing read facility.
    // Exporting a viewed old revision is allowed; editing/ownership is not authority for this read.
    const read = await readResearchDocument(database, localProjectId, selectedId, viewer.id, Number(selectedVersion));
    if (read.document.projectId !== localProjectId || read.document.id !== selectedId || read.revision.version !== Number(selectedVersion)
      || typeof read.revision.body !== "string" || read.revision.body.length > 100000 || !read.revision.body.trim()
      || !wellFormed(read.revision.body) || !sha(read.revision.contentHash)
      || await researchForkDigest(read.revision.body) !== read.revision.contentHash) return unavailable();
    // Bound the private provenance read in SQL; malformed or ambiguous records are not "not a fork".
    const records = await database.prepare(`SELECT
        CASE WHEN length(CAST(agent_metadata_json AS BLOB)) <= ? THEN agent_metadata_json ELSE NULL END AS value,
        length(CAST(agent_metadata_json AS BLOB)) AS bytes
      FROM research_provenance_events WHERE project_id=? AND activity_type='project_forked' LIMIT 2`)
      .bind(SOURCE_BYTES, localProjectId).all<{ value: string | null; bytes: number }>();
    if (!records.results.length) return notFound();
    if (records.results.length !== 1 || typeof records.results[0].value !== "string"
      || !Number.isSafeInteger(records.results[0].bytes) || records.results[0].bytes > SOURCE_BYTES) return unavailable();
    const source = sourceMapping(records.results[0].value, selectedId);
    const context: ResearchChangeContext = { viewerId: viewer.id, projectId: localProjectId, documentId: selectedId,
      version: read.revision.version, body: read.revision.body, contentHash: read.revision.contentHash, source };
    return json(context);
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof ChangeContextError) return json({ error: error.code }, error.status);
    if (error instanceof ResearchWorkspaceError && error.status === 404) return json({ error: "research_change_context_not_found" }, 404);
    if (error instanceof ResearchWorkspaceError && error.status === 403) return json({ error: "research_change_context_forbidden" }, 403);
    return json({ error: "research_change_context_unavailable" }, 503);
  }
}
