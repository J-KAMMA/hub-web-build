import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  developerCapabilityFromRow,
  type DeveloperServiceInput,
} from "@/lib/platform/developer-service";

const select = `SELECT s.id, s.service_name AS serviceName, s.display_name AS displayName,
  s.description, s.homepage_url AS homepageUrl, s.privacy_url AS privacyUrl,
  s.terms_url AS termsUrl, s.status, s.review_note AS reviewNote,
  s.submitted_at AS submittedAt, s.updated_at AS updatedAt,
  c.capability_name AS capabilityName, c.description AS capabilityDescription,
  c.endpoint_url AS endpointUrl, c.http_method AS httpMethod,
  c.input_schema_url AS inputSchemaUrl, c.output_schema_url AS outputSchemaUrl,
  c.permissions_json AS permissionsJson, c.cost_mode AS costMode,
  c.human_approval AS humanApproval
  FROM hub_developer_services s
  JOIN hub_developer_capabilities c ON c.service_id = s.id`;

export async function listDeveloperServices(database: D1Database, profileId: string) {
  return (await database.prepare(`${select} WHERE s.owner_profile_id = ? ORDER BY s.updated_at DESC`)
    .bind(profileId).all()).results;
}

export async function listApprovedDeveloperCapabilities(database: D1Database) {
  const rows = (await database.prepare(`${select} WHERE s.status = 'approved' ORDER BY s.service_name`).all()).results;
  return rows.map((row) => developerCapabilityFromRow(row));
}

export async function createDeveloperService(database: D1Database, profileId: string, input: DeveloperServiceInput) {
  const id = crypto.randomUUID();
  const capabilityId = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO hub_developer_services
       (id, owner_profile_id, service_name, display_name, description, homepage_url,
        privacy_url, terms_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(id, profileId, input.serviceName, input.displayName, input.description,
      input.homepageUrl, input.privacyUrl, input.termsUrl, now, now),
    database.prepare(
      `INSERT INTO hub_developer_capabilities
       (id, service_id, capability_name, description, endpoint_url, http_method,
        input_schema_url, output_schema_url, permissions_json, cost_mode,
        human_approval, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(capabilityId, id, input.capability.name, input.capability.description,
      input.capability.endpointUrl, input.capability.httpMethod,
      input.capability.inputSchemaUrl, input.capability.outputSchemaUrl,
      JSON.stringify(input.capability.permissions), input.capability.costMode,
      input.capability.humanApproval, now, now),
  ]);
  return { id, status: "draft", ...input, createdAt: now, updatedAt: now };
}

export async function submitDeveloperService(database: D1Database, profileId: string, id: string) {
  const now = new Date().toISOString();
  const result = await database.prepare(
    `UPDATE hub_developer_services
     SET status = 'submitted', submitted_at = ?, review_note = '', updated_at = ?
     WHERE id = ? AND owner_profile_id = ? AND status IN ('draft','changes_requested')`,
  ).bind(now, now, id, profileId).run();
  return Boolean(result.meta.changes);
}

export async function revokeDeveloperService(database: D1Database, profileId: string, id: string) {
  const result = await database.prepare(
    `UPDATE hub_developer_services SET status = 'revoked', updated_at = ?
     WHERE id = ? AND owner_profile_id = ? AND status != 'revoked'`,
  ).bind(new Date().toISOString(), id, profileId).run();
  return Boolean(result.meta.changes);
}

export async function reviewDeveloperService(database: D1Database, id: string, input: {
  decision: "approved" | "changes_requested" | "suspended";
  note: string;
}) {
  const now = new Date().toISOString();
  const allowed = input.decision === "suspended" ? "('approved')" : "('submitted')";
  const result = await database.prepare(
    `UPDATE hub_developer_services SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ? AND status IN ${allowed}`,
  ).bind(input.decision, input.note, now, now, id).run();
  return Boolean(result.meta.changes);
}
