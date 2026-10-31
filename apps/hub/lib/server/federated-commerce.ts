import { assertSafeUrl } from "@/lib/encyclopedia/url-security";
import { isRedirectResponse } from "@/lib/redirect-guard";
import {
  type FederatedListing,
  type FederatedSignedQuote,
  validateFederatedListing,
  validateFederatedSignedQuote,
} from "@/lib/platform/federated-commerce";

const MAX_BYTES = 512 * 1024;
const ACCEPT = "application/activity+json, application/ld+json, application/json";

export class FederatedCommerceError extends Error {
  constructor(public readonly code: "unsafe_url" | "unavailable" | "invalid_listing" | "invalid_quote" | "invalid_signature" | "seller_mismatch") {
    super(code);
    this.name = "FederatedCommerceError";
  }
}

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function safeUrl(value: string): Promise<URL> {
  try {
    const url = await assertSafeUrl(value);
    if (url.port || url.username || url.password) throw new Error("unsafe");
    return url;
  } catch {
    throw new FederatedCommerceError("unsafe_url");
  }
}

async function remoteJson(value: string, init: RequestInit, fetcher: typeof fetch): Promise<JsonObject> {
  const url = await safeUrl(value);
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { accept: ACCEPT, "content-type": "application/json", "user-agent": "JKamma-Hub-Federated-Commerce/1.0", ...init.headers },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(7_000),
    });
  } catch {
    throw new FederatedCommerceError("unavailable");
  }
  if (!response.ok || isRedirectResponse(response) || Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
    throw new FederatedCommerceError("unavailable");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BYTES) throw new FederatedCommerceError("unavailable");
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw new FederatedCommerceError("unavailable");
  }
  const parsed = record(decoded);
  if (!parsed) throw new FederatedCommerceError("unavailable");
  return parsed;
}

function listingCandidate(document: JsonObject): unknown {
  if (document.version === "hub.federated-commerce.v1") return document;
  const object = record(document.object) ?? document;
  const attachment = Array.isArray(object.attachment) ? object.attachment : [];
  return attachment.find((item) => record(item)?.version === "hub.federated-commerce.v1");
}

export async function discoverFederatedListing(value: string, fetcher: typeof fetch = fetch): Promise<FederatedListing> {
  const document = await remoteJson(value, { method: "GET" }, fetcher);
  const candidate = listingCandidate(document);
  if (!validateFederatedListing(candidate)) throw new FederatedCommerceError("invalid_listing");
  const requested = await safeUrl(value);
  const canonical = new URL(candidate.listingId);
  const seller = new URL(candidate.sellerActor);
  const node = new URL(candidate.canonicalNode);
  const quote = new URL(candidate.quoteEndpoint);
  if (requested.hostname !== canonical.hostname || canonical.hostname !== seller.hostname || seller.hostname !== node.hostname || node.hostname !== quote.hostname) {
    throw new FederatedCommerceError("seller_mismatch");
  }
  return candidate;
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

export function canonicalQuotePayload(quote: FederatedSignedQuote): Uint8Array {
  const { sellerSignature: _signature, ...payload } = quote;
  return new TextEncoder().encode(stableJson(payload));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonObject)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function actorSigningKey(actorUrl: string, fetcher: typeof fetch): Promise<JsonWebKey> {
  const actor = await remoteJson(actorUrl, { method: "GET" }, fetcher);
  const publicKey = record(actor.publicKey);
  const jwk = record(publicKey?.publicKeyJwk ?? actor.publicKeyJwk);
  if (!jwk || string(publicKey?.owner) !== actorUrl || jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new FederatedCommerceError("invalid_signature");
  }
  return jwk as JsonWebKey;
}

export async function verifyFederatedQuote(quote: unknown, fetcher: typeof fetch = fetch): Promise<FederatedSignedQuote> {
  if (!validateFederatedSignedQuote(quote)) throw new FederatedCommerceError("invalid_quote");
  const key = await actorSigningKey(quote.sellerActor, fetcher);
  try {
    const imported = await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, imported, base64UrlBytes(quote.sellerSignature), canonicalQuotePayload(quote));
    if (!valid) throw new Error("invalid");
  } catch {
    throw new FederatedCommerceError("invalid_signature");
  }
  return quote;
}

export async function requestFederatedQuote(input: {
  listing: FederatedListing;
  buyerActor: string;
  quantity: number;
  route: "direct" | "hub-referral";
}, fetcher: typeof fetch = fetch): Promise<FederatedSignedQuote> {
  const quote = await remoteJson(input.listing.quoteEndpoint, {
    method: "POST",
    body: JSON.stringify({
      version: "hub.federated-quote-request.v1",
      listingId: input.listing.listingId,
      productRevision: input.listing.productRevision,
      buyerActor: input.buyerActor,
      quantity: input.quantity,
      route: input.route,
    }),
  }, fetcher);
  const verified = await verifyFederatedQuote(quote, fetcher);
  if (
    verified.listingId !== input.listing.listingId
    || verified.productRevision !== input.listing.productRevision
    || verified.sellerActor !== input.listing.sellerActor
    || verified.buyerActor !== input.buyerActor
    || verified.quantity !== input.quantity
    || verified.route !== input.route
  ) {
    throw new FederatedCommerceError("invalid_quote");
  }
  return verified;
}
