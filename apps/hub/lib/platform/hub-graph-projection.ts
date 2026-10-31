import type {
  HubActor,
  HubObject,
  HubRelationship,
  HubScopedRef,
} from "@/lib/platform/core-model";

export type HubGraphProfileRow = {
  id: string;
  handle: string;
  display_name: string;
};

export type HubGraphFollowRow = HubGraphProfileRow & {
  created_at: string;
};

export type HubGraphPostRow = {
  id: string;
  created_at: string;
};

export type HubGraphKnowledgeRow = {
  article_slug: string;
  source_id: string;
  source_created_at: string;
  linked_at: string;
};

export type HubGraphDomain = "social" | "knowledge" | "commerce" | "trust" | "agent";

export type HubGraphDomainProjection = {
  domain: HubGraphDomain;
  ownership: "hub" | "hubpedia" | "commerce" | "ai";
  status: "included" | "owner_api_required" | "external_source";
  relationshipCount: number;
  api?: string;
  reconstruction:
    | {
        mode: "hub_query";
        source: string;
        persistence: "hub_local";
      }
    | {
        mode: "owner_api";
        source: string;
        persistence: "reference_only";
      };
};

export interface HubProfileGraphProjection {
  schema: "hub.graph.profile.v1";
  root: HubScopedRef;
  actors: HubActor[];
  objects: HubObject[];
  relationships: HubRelationship[];
  subgraphs: HubGraphDomainProjection[];
}

export interface HubGraphSubgraphProjection {
  schema: "hub.graph.subgraph.v1";
  root: HubScopedRef;
  domain: HubGraphDomain;
  ownership: HubGraphDomainProjection["ownership"];
  status: HubGraphDomainProjection["status"];
  reconstruction: HubGraphDomainProjection["reconstruction"];
  actors: HubActor[];
  objects: HubObject[];
  relationships: HubRelationship[];
  api?: string;
}

function profileRef(id: string): HubScopedRef {
  return { namespace: "hub", kind: "profile", id };
}

function postRef(id: string): HubScopedRef {
  return { namespace: "hub", kind: "post", id };
}

function articleRef(slug: string): HubScopedRef {
  return { namespace: "hubpedia", kind: "article", id: slug };
}

function profileActor(row: HubGraphProfileRow): HubActor {
  return {
    ref: profileRef(row.id),
    kind: "human",
    displayName: row.display_name,
    status: "active",
  };
}

export function buildHubProfileGraphProjection(
  profile: HubGraphProfileRow,
  follows: HubGraphFollowRow[],
  posts: HubGraphPostRow[],
  knowledge: HubGraphKnowledgeRow[] = [],
): HubProfileGraphProjection {
  const root = profileRef(profile.id);
  const postRows = new Map(posts.map((post) => [post.id, post]));
  for (const row of knowledge) {
    if (!postRows.has(row.source_id)) {
      postRows.set(row.source_id, {
        id: row.source_id,
        created_at: row.source_created_at,
      });
    }
  }
  const socialRelationships: HubRelationship[] = [
    ...follows.map((followed) => ({
      subject: root,
      predicate: "hub.social.follows",
      object: profileRef(followed.id),
      visibility: "public" as const,
      validFrom: followed.created_at,
    })),
    ...posts.map((post) => ({
      subject: root,
      predicate: "hub.social.authored",
      object: postRef(post.id),
      visibility: "public" as const,
      validFrom: post.created_at,
    })),
  ];
  const knowledgeRelationships: HubRelationship[] = knowledge.map((row) => ({
    subject: postRef(row.source_id),
    predicate: "hub.knowledge.origin_signal",
    object: articleRef(row.article_slug),
    visibility: "public",
    validFrom: row.linked_at,
  }));
  const trustRelationships: HubRelationship[] = [
    ...posts.map((post) => ({
      subject: root,
      predicate: "hub.trust.publication_evidence",
      object: postRef(post.id),
      visibility: "public" as const,
      validFrom: post.created_at,
    })),
    ...knowledge.map((row) => ({
      subject: root,
      predicate: "hub.trust.knowledge_contribution",
      object: articleRef(row.article_slug),
      visibility: "public" as const,
      validFrom: row.linked_at,
    })),
  ];
  return {
    schema: "hub.graph.profile.v1",
    root,
    actors: [
      profileActor(profile),
      ...follows.map((followed) => profileActor(followed)),
    ],
    objects: [
      ...Array.from(postRows.values()).map((post) => ({
        ref: postRef(post.id),
        kind: "post" as const,
        owner: root,
        visibility: "public" as const,
        status: "active" as const,
      })),
      ...Array.from(new Set(knowledge.map((row) => row.article_slug))).map((slug) => ({
        ref: articleRef(slug),
        kind: "article" as const,
        owner: { namespace: "hubpedia", kind: "service", id: "hubpedia" },
        visibility: "public" as const,
        status: "active" as const,
      })),
    ],
    relationships: [
      ...socialRelationships,
      ...knowledgeRelationships,
      ...trustRelationships,
    ],
    subgraphs: [
      {
        domain: "social",
        ownership: "hub",
        status: "included",
        relationshipCount: socialRelationships.length,
        reconstruction: {
          mode: "hub_query",
          source: "profiles+follows+social_posts",
          persistence: "hub_local",
        },
      },
      {
        domain: "knowledge",
        ownership: "hubpedia",
        status: "included",
        relationshipCount: knowledgeRelationships.length,
        reconstruction: {
          mode: "hub_query",
          source: "hubpedia_social_knowledge_links+social_posts",
          persistence: "hub_local",
        },
      },
      {
        domain: "commerce",
        ownership: "commerce",
        status: "owner_api_required",
        relationshipCount: 0,
        api: "/commerce/api/v1/public/graph",
        reconstruction: {
          mode: "owner_api",
          source: "/commerce/api/v1/public/graph",
          persistence: "reference_only",
        },
      },
      {
        domain: "trust",
        ownership: "hub",
        status: "included",
        relationshipCount: trustRelationships.length,
        reconstruction: {
          mode: "hub_query",
          source: "social_posts+hubpedia_social_knowledge_links",
          persistence: "hub_local",
        },
      },
      {
        domain: "agent",
        ownership: "ai",
        status: "external_source",
        relationshipCount: 0,
        api: "/ai/api/a2a/agents",
        reconstruction: {
          mode: "owner_api",
          source: "/ai/api/a2a/agents",
          persistence: "reference_only",
        },
      },
    ],
  };
}

const DOMAIN_PREDICATE_PREFIX: Record<HubGraphDomain, string> = {
  social: "hub.social.",
  knowledge: "hub.knowledge.",
  commerce: "hub.commerce.",
  trust: "hub.trust.",
  agent: "hub.agent.",
};

function refKey(ref: HubScopedRef) {
  return `${ref.namespace}:${ref.kind}:${ref.id}`;
}

export function selectHubGraphSubgraph(
  graph: HubProfileGraphProjection,
  domain: HubGraphDomain,
): HubGraphSubgraphProjection {
  const metadata = graph.subgraphs.find((item) => item.domain === domain);
  if (!metadata) {
    throw new Error(`hub_graph_domain_missing:${domain}`);
  }

  const relationships = graph.relationships.filter((relationship) =>
    relationship.predicate.startsWith(DOMAIN_PREDICATE_PREFIX[domain])
  );
  const referenced = new Set<string>([refKey(graph.root)]);
  for (const relationship of relationships) {
    referenced.add(refKey(relationship.subject));
    referenced.add(refKey(relationship.object));
  }

  return {
    schema: "hub.graph.subgraph.v1",
    root: graph.root,
    domain,
    ownership: metadata.ownership,
    status: metadata.status,
    reconstruction: metadata.reconstruction,
    actors: graph.actors.filter((actor) => referenced.has(refKey(actor.ref))),
    objects: graph.objects.filter((object) => referenced.has(refKey(object.ref))),
    relationships,
    ...(metadata.api ? { api: metadata.api } : {}),
  };
}
