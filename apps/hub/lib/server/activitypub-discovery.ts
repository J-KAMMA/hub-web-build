import { assertSafeUrl } from "@/lib/encyclopedia/url-security";
import { isRedirectResponse } from "@/lib/redirect-guard";

const ACCEPT = "application/activity+json, application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\", application/json";
const MAX_DOCUMENT_BYTES = 512 * 1024;
const MAX_POSTS = 12;

export type ActivityPubActor = {
  id: string;
  url: string;
  handle: string;
  name: string;
  summary: string;
};

export type ActivityPubPost = {
  id: string;
  url: string;
  content: string;
  published?: string;
};

export type ActivityPubDiscovery = {
  actor?: ActivityPubActor;
  posts: ActivityPubPost[];
  discoveredTargets: string[];
  resolvedUrl: string;
};

export class ActivityPubDiscoveryError extends Error {
  constructor(public readonly code: "invalid_query" | "unsafe_url" | "not_found" | "unavailable" | "invalid_document") {
    super(code);
    this.name = "ActivityPubDiscoveryError";
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function plainText(value: unknown): string {
  return text(value)
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, "\"")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function parseActivityPubQuery(value: string): { kind: "acct"; account: string; host: string } | { kind: "url"; url: string } {
  const query = value.trim();
  const account = query.replace(/^acct:/iu, "").replace(/^@/u, "");
  const match = /^([^@\s/]+)@([^@\s/]+)$/u.exec(account);
  if (match) return { kind: "acct", account: match[1], host: match[2].toLowerCase() };
  try {
    const url = new URL(query);
    if (url.protocol === "https:") return { kind: "url", url: url.toString() };
  } catch {
    // Normal Hub searches are intentionally not sent to arbitrary federation servers.
  }
  throw new ActivityPubDiscoveryError("invalid_query");
}

async function safeRemoteUrl(value: string): Promise<URL> {
  try {
    const url = await assertSafeUrl(value);
    if (url.port) throw new ActivityPubDiscoveryError("unsafe_url");
    return url;
  } catch (error) {
    if (error instanceof ActivityPubDiscoveryError) throw error;
    throw new ActivityPubDiscoveryError("unsafe_url");
  }
}

async function fetchJson(urlValue: string, fetcher: typeof fetch): Promise<JsonObject> {
  const url = await safeRemoteUrl(urlValue);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: ACCEPT, "user-agent": "JKamma-Hub-ActivityPub-Discovery/1.0" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    throw new ActivityPubDiscoveryError("unavailable");
  }
  if (isRedirectResponse(response)) throw new ActivityPubDiscoveryError("unavailable");
  if (response.status === 404) throw new ActivityPubDiscoveryError("not_found");
  if (!response.ok) throw new ActivityPubDiscoveryError("unavailable");
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (announced > MAX_DOCUMENT_BYTES) throw new ActivityPubDiscoveryError("invalid_document");
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_DOCUMENT_BYTES) throw new ActivityPubDiscoveryError("invalid_document");
  try {
    const parsed = object(JSON.parse(body));
    if (!parsed) throw new Error("not_object");
    return parsed;
  } catch {
    throw new ActivityPubDiscoveryError("invalid_document");
  }
}

function publicUrl(value: unknown, fallback = ""): string {
  const candidate = text(value) || fallback;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function actorFrom(document: JsonObject): ActivityPubActor | undefined {
  const type = text(document.type);
  if (!["Person", "Service", "Application", "Organization", "Group"].includes(type)) return undefined;
  const id = publicUrl(document.id);
  if (!id) return undefined;
  const username = text(document.preferredUsername);
  const host = new URL(id).hostname;
  return {
    id,
    url: publicUrl(document.url, id),
    handle: username ? `@${username}@${host}` : host,
    name: plainText(document.name) || username || host,
    summary: plainText(document.summary).slice(0, 500),
  };
}

function postFrom(value: unknown): ActivityPubPost | undefined {
  const item = object(value);
  if (!item) return undefined;
  const candidate = text(item.type).match(/^(Create|Announce)$/u) ? object(item.object) : item;
  if (!candidate || !["Note", "Article", "Page", "Video", "Audio", "Image"].includes(text(candidate.type))) return undefined;
  const id = publicUrl(candidate.id);
  if (!id) return undefined;
  const content = plainText(candidate.content || candidate.summary || candidate.name).slice(0, 2_000);
  if (!content) return undefined;
  return { id, url: publicUrl(candidate.url, id), content, published: text(candidate.published) || undefined };
}

function collectionItems(document: JsonObject): unknown[] {
  const items = document.orderedItems ?? document.items;
  return Array.isArray(items) ? items : [];
}

function collectPublicActorTargets(value: unknown, targets: Set<string>, depth = 0): void {
  if (depth > 5 || targets.size >= 32) return;
  if (typeof value === "string") {
    const candidate = publicUrl(value);
    if (candidate) targets.add(candidate);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPublicActorTargets(item, targets, depth + 1);
    return;
  }
  const record = object(value);
  if (!record) return;
  for (const key of ["actor", "attributedTo", "author"]) {
    collectPublicActorTargets(record[key], targets, depth + 1);
  }
  const tags = Array.isArray(record.tag) ? record.tag : [];
  for (const tag of tags) {
    const tagObject = object(tag);
    if (text(tagObject?.type) === "Mention") collectPublicActorTargets(tagObject?.href, targets, depth + 1);
  }
  if (["Create", "Announce", "Update", "Offer"].includes(text(record.type))) {
    collectPublicActorTargets(record.object, targets, depth + 1);
  }
}

async function resolveWebFinger(account: string, host: string, fetcher: typeof fetch): Promise<string> {
  const endpoint = new URL(`https://${host}/.well-known/webfinger`);
  endpoint.searchParams.set("resource", `acct:${account}@${host}`);
  const document = await fetchJson(endpoint.toString(), fetcher);
  const links = Array.isArray(document.links) ? document.links : [];
  for (const value of links) {
    const link = object(value);
    if (text(link?.rel) !== "self") continue;
    const type = text(link?.type);
    if (type && !type.includes("activity+json") && !type.includes("ld+json")) continue;
    const href = publicUrl(link?.href);
    if (href) return (await safeRemoteUrl(href)).toString();
  }
  throw new ActivityPubDiscoveryError("not_found");
}

export async function discoverActivityPub(value: string, fetcher: typeof fetch = fetch): Promise<ActivityPubDiscovery> {
  const query = parseActivityPubQuery(value);
  const resolvedUrl = query.kind === "acct"
    ? await resolveWebFinger(query.account, query.host, fetcher)
    : (await safeRemoteUrl(query.url)).toString();
  const document = await fetchJson(resolvedUrl, fetcher);
  const actor = actorFrom(document);
  const directPost = postFrom(document);
  const posts: ActivityPubPost[] = directPost ? [directPost] : [];
  const discoveredTargets = new Set<string>();
  collectPublicActorTargets(document, discoveredTargets);

  if (actor && text(document.outbox)) {
    const outbox = await fetchJson(text(document.outbox), fetcher).catch(() => undefined);
    if (outbox) {
      let items = collectionItems(outbox);
      if (!items.length && text(outbox.first)) {
        const first = await fetchJson(text(outbox.first), fetcher).catch(() => undefined);
        if (first) items = collectionItems(first);
      }
      collectPublicActorTargets(items, discoveredTargets);
      posts.push(...items.map(postFrom).filter((item): item is ActivityPubPost => Boolean(item)).slice(0, MAX_POSTS));
    }
  }

  if (!actor && !posts.length) throw new ActivityPubDiscoveryError("invalid_document");
  discoveredTargets.delete(resolvedUrl);
  if (actor) discoveredTargets.delete(actor.id);
  return { actor, posts: posts.slice(0, MAX_POSTS), discoveredTargets: [...discoveredTargets].slice(0, 24), resolvedUrl };
}
