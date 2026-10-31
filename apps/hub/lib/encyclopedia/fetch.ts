import { createHash } from "node:crypto";
import { assertSafeSourceUrl } from "./safe-url";

export interface FetchOptions { timeoutMs: number; maxBytes: number; fetchImpl?: typeof fetch; maxRedirects?: number; }
export interface FetchedSource { bytes: Uint8Array; contentHash: string; mimeType: string; finalUrl: string; }

export async function fetchSource(input: string, options: FetchOptions): Promise<FetchedSource> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let url = await assertSafeSourceUrl(input);
  for (let redirects = 0; redirects <= (options.maxRedirects ?? 5); redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try { response = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "WorldGovernmentHub-Encyclopedia/0.1" } }); }
    finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response omitted Location.");
      url = await assertSafeSourceUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    const mimeType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (mimeType !== "text/html" && mimeType !== "application/xhtml+xml") throw new Error("Unsupported source Content-Type.");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > options.maxBytes) throw new Error("Source exceeds the configured size limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Source response has no body.");
    const parts: Uint8Array[] = []; let total = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > options.maxBytes) { await reader.cancel(); throw new Error("Source exceeds the configured size limit."); } parts.push(value); }
    const bytes = new Uint8Array(total); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return { bytes, contentHash: createHash("sha256").update(bytes).digest("hex"), mimeType, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects.");
}

