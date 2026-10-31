import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubSuspendedError } from "@/lib/server/hub-session";
import {
  isArticlePublicationRequestId, parsePublishInput, publishUserArticle,
  UserArticlePublicationConflictError, UserArticleRateLimitError, UserArticleValidationError,
} from "@/lib/server/d1-user-articles";

const MAX_BYTES = 768 * 1024;
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", ...headers },
});
class ArticleInputError extends Error { constructor(public status = 400) { super("invalid_request"); } }
const invalid = (): never => { throw new ArticleInputError(); };
const wellFormed = (value: string) => !/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value: unknown, max: number, empty = false) => {
  if (typeof value !== "string" || !wellFormed(value) || Array.from(value).length > max || !empty && !value.trim()) invalid();
};

async function readPublicationInput(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") invalid();
  const reader = request.body?.getReader(); if (!reader) return invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true }); let value = "", size = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read(); if (done) break;
      size += chunk.byteLength;
      if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new ArticleInputError(413); }
      value += decoder.decode(chunk, { stream: true });
    }
    value += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ArticleInputError) throw error;
    return invalid();
  } finally { reader.releaseLock(); }
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { return invalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid();
  const body = parsed as Record<string, unknown>;
  const allowed = ["title", "summary", "body", "tags", "thumbnailUrl", "audience", "access", "clientRequestId"];
  if (Object.keys(body).some(key => !allowed.includes(key)) || !isArticlePublicationRequestId(body.clientRequestId)) invalid();
  text(body.title, 120); text(body.body, 100000);
  if (body.summary !== undefined) text(body.summary, 400, true);
  if (body.thumbnailUrl !== undefined && body.thumbnailUrl !== null) text(body.thumbnailUrl, 500, true);
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 8) return invalid();
    for (const tag of body.tags) {
      text(tag, 24);
      if ((tag as string).length > 24 || /\p{Cc}/u.test(tag as string)) invalid();
    }
  }
  if (body.access !== undefined && !["public", "vault"].includes(body.access as string)) invalid();
  if (body.audience !== undefined && !["general", "adult"].includes(body.audience as string)) invalid();
  return body;
}

/** Free general articles only; the operation UUID binds one author to one normalized payload. */
export async function POST(request: Request) {
  try {
    if (new URL(request.url).search) return json({ error: "invalid_request" }, 400);
    if (!hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1(), profile = await requireDesktopHubProfile(request, database);
    const payload = await readPublicationInput(request);
    if (payload.access === "vault") return json({ error: "unsupported_access" }, 409);
    if (payload.audience === "adult") return json({ error: "unsupported_audience" }, 409);
    const input = parsePublishInput(payload);
    const { article, duplicate } = await publishUserArticle(database, profile, input);
    return json({ id: article.id, href: `/articles/${article.id}`, duplicate, clientRequestId: input.clientRequestId }, duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof ArticleInputError) return json({ error: error.status === 413 ? "request_too_large" : "invalid_request" }, error.status);
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof UserArticlePublicationConflictError) return json({ error: "publication_conflict" }, 409);
    if (error instanceof UserArticleValidationError) return json({ error: "invalid_request" }, 400);
    if (error instanceof UserArticleRateLimitError) return json({ error: "publication_rate_limited" }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    return json({ error: "publication_failed" }, 500);
  }
}
