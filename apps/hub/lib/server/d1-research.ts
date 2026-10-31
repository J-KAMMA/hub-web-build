import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import {
  RESEARCH_OBJECT_TYPES,
  RESEARCH_VISIBILITIES,
  validateResearchObject,
  type ResearchObjectType,
  type ResearchVisibility,
} from "@/lib/desci-core";

export type ResearchProject = {
  id: string;
  ownerProfileId: string;
  title: string;
  description: string;
  status: "draft" | "active" | "paused" | "completed" | "withdrawn";
  visibility: ResearchVisibility;
  defaultLicense: string | null;
  createdAt: string;
  updatedAt: string;
  objectCount: number;
};

export type ResearchObject = {
  id: string;
  projectId: string;
  createdByProfileId: string;
  objectType: ResearchObjectType;
  title: string;
  version: number;
  contentHash: `sha256:${string}`;
  license: string | null;
  visibility: ResearchVisibility;
  reviewStatus: string;
  reproducibilityStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type ResearchRelation = {
  fromObjectId: string;
  toObjectId: string;
  relationType: "supported_by" | "contradicted_by" | "replicated_by" | "supersedes" | "derived_from" | "uses_protocol" | "included_in" | "reviewed_by";
  createdAt: string;
};

const projectSelect = `SELECT p.id,p.owner_profile_id ownerProfileId,p.title,p.description,p.status,p.visibility,
  p.default_license defaultLicense,p.created_at createdAt,p.updated_at updatedAt,
  COUNT(o.id) objectCount FROM research_projects p
  LEFT JOIN research_objects o ON o.project_id=p.id
    AND (o.visibility='public' OR p.owner_profile_id=?)`;

export async function listResearchProjects(database: D1Database, viewerId?: string | null, options: { query?: string; limit?: number; offset?: number; excludeWithdrawn?: boolean; publicOnly?: boolean } = {}) {
  const terms = (options.query ?? "").trim().slice(0, 100).split(/\s+/u).filter(Boolean).slice(0, 8);
  const match = terms.map(() => "instr(lower(p.title || ' ' || coalesce(p.description, '')), lower(?)) > 0");
  const rows = await database.prepare(`${projectSelect}
    WHERE ${options.publicOnly ? "p.visibility='public'" : "(p.visibility='public' OR p.owner_profile_id=?)"}
    ${options.excludeWithdrawn ? "AND p.status!='withdrawn'" : ""}
    ${match.length ? `AND ${match.join(" AND ")}` : ""}
    GROUP BY p.id ORDER BY p.updated_at DESC, p.id ASC LIMIT ? OFFSET ?`)
    .bind(viewerId ?? "", ...(options.publicOnly ? [] : [viewerId ?? ""]), ...terms, Math.min(101, Math.max(1, Math.trunc(options.limit ?? 100))), Math.max(0, Math.trunc(options.offset ?? 0))).all<ResearchProject>();
  return rows.results;
}

export async function getResearchProject(database: D1Database, id: string, viewerId?: string | null) {
  return database.prepare(`${projectSelect}
    WHERE p.id=? AND (p.visibility='public' OR p.owner_profile_id=?)
    GROUP BY p.id`).bind(viewerId ?? "", id, viewerId ?? "").first<ResearchProject>();
}

export async function updateResearchProject(database: D1Database, id: string, viewerId: string, input: Record<string, unknown>) {
  const project = await getResearchProject(database, id, viewerId);
  if (!project) throw new Error('research_not_found');
  if (project.ownerProfileId !== viewerId) throw new Error('research_forbidden');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const license = typeof input.defaultLicense === 'string' ? input.defaultLicense.trim() : '';
  if (title.length < 3 || title.length > 240 || description.length > 5000 || license.length > 200 || !['draft','active','paused','completed','withdrawn'].includes(String(input.status))) throw new Error('invalid_research_project');
  await database.prepare('UPDATE research_projects SET title=?,description=?,status=?,default_license=?,updated_at=? WHERE id=? AND owner_profile_id=?')
    .bind(title, description, input.status, license || null, new Date().toISOString(), id, viewerId).run();
  return getResearchProject(database, id, viewerId);
}

export async function createResearchProject(database: D1Database, ownerProfileId: string, input: Record<string, unknown>) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const visibility = input.visibility;
  const defaultLicense = typeof input.defaultLicense === "string" ? input.defaultLicense.trim().slice(0, 200) || null : null;
  if (title.length < 3 || title.length > 240 || description.length > 5000 || !RESEARCH_VISIBILITIES.includes(visibility as ResearchVisibility)) {
    throw new Error("invalid_research_project");
  }
  const id = `rp_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO research_projects
    (id,owner_profile_id,title,description,status,visibility,default_license,created_at,updated_at)
    VALUES(?,?,?,?,'draft',?,?,?,?)`).bind(id, ownerProfileId, title, description, visibility, defaultLicense, now, now).run();
  return getResearchProject(database, id, ownerProfileId);
}

export async function listResearchObjects(database: D1Database, projectId: string, viewerId?: string | null) {
  const viewer = viewerId ?? "";
  const [objects, relations] = await database.batch([
    database.prepare(`SELECT o.id,o.project_id projectId,o.created_by_profile_id createdByProfileId,
      o.object_type objectType,o.title,o.version,o.content_hash contentHash,o.license,o.visibility,
      o.review_status reviewStatus,o.reproducibility_status reproducibilityStatus,
      o.created_at createdAt,o.updated_at updatedAt FROM research_objects o
      JOIN research_projects p ON p.id=o.project_id
      WHERE o.project_id=? AND (p.visibility='public' OR p.owner_profile_id=?)
        AND (o.visibility='public' OR p.owner_profile_id=?)
      ORDER BY o.created_at DESC`).bind(projectId, viewer, viewer),
    database.prepare(`SELECT r.from_object_id fromObjectId,r.to_object_id toObjectId,
      r.relation_type relationType,r.created_at createdAt FROM research_object_relations r
      JOIN research_objects o ON o.id=r.from_object_id
      JOIN research_objects target ON target.id=r.to_object_id AND target.project_id=o.project_id
      JOIN research_projects p ON p.id=o.project_id
      WHERE o.project_id=? AND (p.visibility='public' OR p.owner_profile_id=?)
        AND (o.visibility='public' OR p.owner_profile_id=?)
        AND (target.visibility='public' OR p.owner_profile_id=?)
      ORDER BY r.created_at DESC`).bind(projectId, viewer, viewer, viewer),
  ]);
  return {
    objects: (objects.results ?? []) as ResearchObject[],
    relations: (relations.results ?? []) as ResearchRelation[],
  };
}

export async function createResearchObject(database: D1Database, project: ResearchProject, profileId: string, input: Record<string, unknown>) {
  if (project.ownerProfileId !== profileId) throw new Error("research_forbidden");
  const id = `ro_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  const objectType = input.objectType as ResearchObjectType;
  if (!RESEARCH_OBJECT_TYPES.includes(objectType)) throw new Error("invalid_research_object_type");
  const record = validateResearchObject({
    id,
    projectId: project.id,
    type: objectType,
    title: typeof input.title === "string" ? input.title : "",
    version: Number(input.version ?? 1),
    contentHash: String(input.contentHash ?? "") as `sha256:${string}`,
    license: typeof input.license === "string" ? input.license.trim().slice(0, 200) || null : null,
    visibility: input.visibility as ResearchVisibility,
    createdAt: now,
    createdByProfileId: profileId,
    supersedesId: null,
    derivedFromIds: [],
  });
  await database.batch([
    database.prepare(`INSERT INTO research_objects
      (id,project_id,created_by_profile_id,object_type,title,version,content_hash,license,visibility,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id, project.id, profileId, record.type, record.title, record.version, record.contentHash, record.license, record.visibility, now, now),
    database.prepare(`INSERT INTO research_provenance_events
      (id,project_id,object_id,actor_profile_id,activity_type,output_hash,occurred_at)
      VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), project.id, id, profileId, "object_registered", record.contentHash, now),
    database.prepare("UPDATE research_projects SET updated_at=? WHERE id=?").bind(now, project.id),
  ]);
  return id;
}

export async function createResearchRelation(database: D1Database, project: ResearchProject, profileId: string, input: Record<string, unknown>) {
  if (project.ownerProfileId !== profileId) throw new Error("research_forbidden");
  const from = String(input.fromObjectId ?? "");
  const to = String(input.toObjectId ?? "");
  const type = String(input.relationType ?? "");
  const allowed = ["supported_by", "contradicted_by", "replicated_by", "supersedes", "derived_from", "uses_protocol", "included_in", "reviewed_by"];
  if (!from || !to || from === to || !allowed.includes(type)) throw new Error("invalid_research_relation");
  const rows = await database.prepare("SELECT id FROM research_objects WHERE project_id=? AND id IN (?,?)").bind(project.id, from, to).all();
  if (rows.results.length !== 2) throw new Error("invalid_research_relation");
  await database.prepare(`INSERT OR IGNORE INTO research_object_relations
    (from_object_id,to_object_id,relation_type,created_at) VALUES(?,?,?,?)`)
    .bind(from, to, type, new Date().toISOString()).run();
}
