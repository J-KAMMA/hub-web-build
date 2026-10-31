export const RESEARCH_OBJECT_TYPES = [
  "question",
  "hypothesis",
  "protocol",
  "preregistration",
  "experiment_run",
  "dataset",
  "software",
  "model",
  "notebook",
  "claim",
  "evidence",
  "review",
  "replication",
  "paper",
  "license",
] as const;

export const RESEARCH_VISIBILITIES = [
  "public",
  "embargoed",
  "controlled",
  "confidential",
  "restricted",
] as const;

export const CREDIT_ROLES = [
  "conceptualization",
  "methodology",
  "software",
  "data_curation",
  "investigation",
  "formal_analysis",
  "validation",
  "visualization",
  "funding_acquisition",
  "project_administration",
  "writing",
  "supervision",
  "resources",
] as const;

export type ResearchObjectType = (typeof RESEARCH_OBJECT_TYPES)[number];
export type ResearchVisibility = (typeof RESEARCH_VISIBILITIES)[number];
export type CreditRole = (typeof CREDIT_ROLES)[number];

export type ResearchObjectRecord = {
  id: string;
  projectId: string;
  type: ResearchObjectType;
  title: string;
  version: number;
  contentHash: `sha256:${string}`;
  license: string | null;
  visibility: ResearchVisibility;
  createdAt: string;
  createdByProfileId: string;
  supersedesId: string | null;
  derivedFromIds: string[];
};

export type ResearchClaimRelation =
  | "supported_by"
  | "contradicted_by"
  | "replicated_by"
  | "supersedes"
  | "derived_from";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{2,127}$/u;

export function validateResearchObject(input: ResearchObjectRecord): ResearchObjectRecord {
  if (!SAFE_ID.test(input.id) || !SAFE_ID.test(input.projectId)) throw new Error("invalid_research_id");
  if (!RESEARCH_OBJECT_TYPES.includes(input.type)) throw new Error("invalid_research_object_type");
  if (!RESEARCH_VISIBILITIES.includes(input.visibility)) throw new Error("invalid_research_visibility");
  if (!input.title.trim() || input.title.length > 240) throw new Error("invalid_research_title");
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Error("invalid_research_version");
  if (!SHA256.test(input.contentHash)) throw new Error("invalid_research_content_hash");
  if (input.supersedesId === input.id || input.derivedFromIds.includes(input.id)) {
    throw new Error("cyclic_research_provenance");
  }
  return {
    ...input,
    title: input.title.trim(),
    derivedFromIds: [...new Set(input.derivedFromIds)].sort(),
  };
}

export function buildRoCrateMetadata(
  project: { id: string; title: string; description: string; license: string | null },
  objects: readonly ResearchObjectRecord[],
) {
  const graph = [
    {
      "@id": "ro-crate-metadata.json",
      "@type": "CreativeWork",
      about: { "@id": "./" },
      conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
    },
    {
      "@id": "./",
      "@type": "Dataset",
      identifier: project.id,
      name: project.title,
      description: project.description,
      ...(project.license ? { license: project.license } : {}),
      hasPart: objects.map((object) => ({ "@id": `objects/${object.id}` })),
    },
    ...objects.map((object) => ({
      "@id": `objects/${object.id}`,
      "@type": object.type === "dataset" ? "Dataset" : "CreativeWork",
      identifier: object.id,
      name: object.title,
      version: String(object.version),
      sha256: object.contentHash.slice("sha256:".length),
      dateCreated: object.createdAt,
      ...(object.license ? { license: object.license } : {}),
      ...(object.derivedFromIds.length
        ? { isBasedOn: object.derivedFromIds.map((id) => ({ "@id": `objects/${id}` })) }
        : {}),
    })),
  ];
  return { "@context": "https://w3id.org/ro/crate/1.1/context", "@graph": graph };
}
