import type {
  HubActorKind,
  HubObjectKind,
  HubScopedRef,
} from "@/lib/platform/core-model";
import { isHubScopedRef } from "@/lib/platform/core-model";

export type HubCoreSearchEntity =
  | {
      entityType: "actor";
      ref: HubScopedRef;
      actorKind: HubActorKind;
      title: string;
      href: string;
      sourceGroup: string;
    }
  | {
      entityType: "object";
      ref: HubScopedRef;
      objectKind: HubObjectKind;
      title: string;
      href: string;
      sourceGroup: string;
    };

type SearchEntityInput = {
  profiles?: Array<{ id: string; handle: string; displayName: string }>;
  posts?: Array<{ id: string; body: string }>;
  threads?: Array<{ id: string; title: string }>;
  boards?: Array<{ id: string; key: string; title: string }>;
  hubpedia?: Array<{ slug: string; title: string; href?: string }>;
  communities?: Array<{ id: string; name: string; slug?: string | null }>;
  videos?: Array<{ id: string; title: string }>;
  products?: Array<{ id: string; title: string }>;
  lists?: Array<{ id: string; name: string }>;
  tokens?: Array<{ id: string; title: string }>;
  work?: Array<{ id: string; title: string; kind?: string }>;
  listings?: Array<{ id: string; title: string; kind?: string }>;
};

function ref(kind: string, id: string): HubScopedRef | null {
  const candidate = { namespace: "hub", kind, id };
  return isHubScopedRef(candidate) ? candidate : null;
}

function actor(
  kind: HubActorKind,
  refKind: string,
  id: string,
  title: string,
  href: string,
  sourceGroup: string,
): HubCoreSearchEntity | null {
  const scopedRef = ref(refKind, id);
  return scopedRef
    ? {
        entityType: "actor",
        ref: scopedRef,
        actorKind: kind,
        title,
        href,
        sourceGroup,
      }
    : null;
}

function object(
  kind: HubObjectKind,
  id: string,
  title: string,
  href: string,
  sourceGroup: string,
): HubCoreSearchEntity | null {
  const scopedRef = ref(kind, id);
  return scopedRef
    ? {
        entityType: "object",
        ref: scopedRef,
        objectKind: kind,
        title,
        href,
        sourceGroup,
      }
    : null;
}

function compact(
  entities: Array<HubCoreSearchEntity | null>,
): HubCoreSearchEntity[] {
  return entities.filter((entity): entity is HubCoreSearchEntity => entity !== null);
}

function safeRelativeHref(value: string | undefined): string | null {
  const href = value?.trim() ?? "";
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/u.test(href)) return null;
  try {
    const url = new URL(href, "https://hub.invalid");
    if (url.origin !== "https://hub.invalid" || url.username || url.password) return null;
  } catch {
    return null;
  }
  return href;
}

/*
 * Keep a broad search useful when one source has many matches. Each source
 * keeps its own relevance order, while the shared projection gives the first
 * page a chance to show several kinds of public result.
 */
function interleave(
  groups: Array<Array<HubCoreSearchEntity | null>>,
): HubCoreSearchEntity[] {
  const result: HubCoreSearchEntity[] = [];
  const length = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < length; index += 1) {
    for (const group of groups) {
      const entity = group[index];
      if (entity) result.push(entity);
    }
  }
  return result;
}

export function toHubCoreSearchEntities(
  input: SearchEntityInput,
): HubCoreSearchEntity[] {
  const entities = compact([
    ...(input.profiles ?? []).map((item) =>
      actor(
        "human",
        "profile",
        item.id,
        item.displayName,
        `/profile/${encodeURIComponent(item.handle)}`,
        "profiles",
      ),
    ),
    ...(input.communities ?? []).map((item) =>
      actor(
        "community",
        "community",
        item.id,
        item.name,
        `/community?community=${encodeURIComponent(item.slug ?? item.id)}`,
        "communities",
      ),
    ),
    ...(input.posts ?? []).map((item) =>
      object("post", item.id, item.body.slice(0, 120), `/posts/${encodeURIComponent(item.id)}`, "posts"),
    ),
    ...(input.threads ?? []).map((item) =>
      object("thread", item.id, item.title, `/threads/${encodeURIComponent(item.id)}`, "threads"),
    ),
    ...(input.boards ?? []).map((item) =>
      object(
        "board",
        item.id,
        item.title,
        `/bbs/${encodeURIComponent(item.key)}`,
        "boards",
      ),
    ),
    ...(input.hubpedia ?? []).map((item) =>
      object(
        "article",
        item.slug,
        item.title,
        safeRelativeHref(item.href) ?? `/hubpedia/${encodeURIComponent(item.slug)}`,
        "hubpedia",
      ),
    ),
    ...(input.videos ?? []).map((item) =>
      object("video", item.id, item.title, `/videos/${encodeURIComponent(item.id)}`, "videos"),
    ),
    ...(input.products ?? []).map((item) =>
      object(
        "product",
        item.id,
        item.title,
        `/market/products/${encodeURIComponent(item.id)}`,
        "products",
      ),
    ),
    ...(input.lists ?? []).map((item) =>
      object(
        "list",
        item.id,
        item.name,
        `/v2/lists?tab=community&list=${encodeURIComponent(item.id)}`,
        "lists",
      ),
    ),
    ...(input.tokens ?? []).map((item) =>
      object("contract", item.id, item.title, `/token?token=${encodeURIComponent(item.id)}`, "tokens"),
    ),
    ...(input.work ?? []).map((item) =>
      object(
        item.kind === "project" ? "project" : "job",
        item.id,
        item.title,
        `/work?listing=${encodeURIComponent(item.id)}`,
        "work",
      ),
    ),
    ...(input.listings ?? []).map((item) =>
      object(
        item.kind === "property"
          ? "property"
          : item.kind === "vehicle"
            ? "vehicle"
            : item.kind === "job"
            ? "job"
              : "product",
        item.id,
        item.title,
        `/services?listing=${encodeURIComponent(item.id)}`,
        "listings",
      ),
    ),
  ]);
  const sourceOrder = [
    "profiles",
    "communities",
    "posts",
    "threads",
    "boards",
    "hubpedia",
    "videos",
    "products",
    "lists",
    "tokens",
    "work",
    "listings",
  ];
  return interleave(sourceOrder.map((source) => entities.filter((entity) => entity.sourceGroup === source)));
}
