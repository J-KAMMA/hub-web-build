import { createHash } from "node:crypto";
import { assertSafeUrl } from "./url-security";

export class SourceFetchError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = "SourceFetchError"; } }
export interface FetchOptions { timeoutMs: number; maxBytes: number; maxRedirects?: number; fetchImpl?: typeof fetch; validateUrl?: typeof assertSafeUrl; }
export interface FetchedSource { body: Uint8Array; contentHash: string; mimeType: string; finalUrl: string; retrievedAt: Date; headers: Record<string, string>; }
/* PDFs are allowed because government publications often are one; the text is
 * pulled out by lib/encyclopedia/source-text.ts rather than decoded as UTF-8. */
const ALLOWED_MIME = new Set(["text/html", "application/xhtml+xml", "text/plain", "application/pdf"]);

export async function fetchSource(rawUrl: string, options: FetchOptions): Promise<FetchedSource> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const validate = options.validateUrl ?? assertSafeUrl;
  let current = (await validate(rawUrl)).toString();
  for (let redirects = 0; redirects <= (options.maxRedirects ?? 5); redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try { response = await fetchImpl(current, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "WorldGovernmentHub-Encyclopedia/1.0", accept: "text/html,application/xhtml+xml,text/plain,application/pdf" } }); }
    catch (error) { throw new SourceFetchError(error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error", error instanceof Error ? error.message : "Source request failed."); }
    finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new SourceFetchError("invalid_redirect", "Redirect response has no location.");
      if (redirects === (options.maxRedirects ?? 5)) throw new SourceFetchError("too_many_redirects", "Too many redirects.");
      current = (await validate(new URL(location, current).toString())).toString();
      continue;
    }
    if (!response.ok) throw new SourceFetchError("http_error", `Source returned HTTP ${response.status}.`);
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) throw new SourceFetchError("unsupported_mime", `Unsupported Content-Type: ${mimeType || "missing"}.`);
    const announced = Number(response.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > options.maxBytes) throw new SourceFetchError("response_too_large", "Source exceeds the configured size limit.");
    if (!response.body) throw new SourceFetchError("empty_body", "Source returned no body.");
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > options.maxBytes) { await reader.cancel(); throw new SourceFetchError("response_too_large", "Source exceeds the configured size limit."); } parts.push(value); }
    const body = new Uint8Array(size); let offset = 0; for (const part of parts) { body.set(part, offset); offset += part.length; }
    return { body, contentHash: createHash("sha256").update(body).digest("hex"), mimeType, finalUrl: current, retrievedAt: new Date(), headers: { etag: response.headers.get("etag") ?? "", lastModified: response.headers.get("last-modified") ?? "" } };
  }
  throw new SourceFetchError("too_many_redirects", "Too many redirects.");
}
