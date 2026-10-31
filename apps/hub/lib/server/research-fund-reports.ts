import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

/*
 * 研究プロジェクトの「資金の使い道」報告（docs/architecture/hub-desci-funding-v1.md step 4）。
 * 書けるのはオーナーだけ。読めるのは公開プロジェクトか本人。ゲートしない。Hub は資金を預からない。
 */

export type ResearchFundReportFailure = "research_not_found" | "research_forbidden" | "invalid_input" | "report_not_found";

export class ResearchFundReportError extends Error {
  constructor(readonly code: ResearchFundReportFailure) {
    super(code);
    this.name = "ResearchFundReportError";
  }
}

export type ResearchFundReport = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  amount: string | null;
  evidenceUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export const FUND_REPORT_LIMITS = { title: 120, body: 4000, amount: 60, url: 500 } as const;

function text(value: unknown, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ResearchFundReportError("invalid_input");
    return null;
  }
  if (typeof value !== "string") throw new ResearchFundReportError("invalid_input");
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new ResearchFundReportError("invalid_input");
    return null;
  }
  if (trimmed.length > max) throw new ResearchFundReportError("invalid_input");
  return trimmed;
}

function httpsUrl(value: unknown): string | null {
  const raw = text(value, FUND_REPORT_LIMITS.url, false);
  if (raw === null) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("bad");
  } catch {
    throw new ResearchFundReportError("invalid_input");
  }
  return raw;
}

export function validateFundReportInput(input: unknown): { title: string; body: string; amount: string | null; evidenceUrl: string | null } {
  if (!input || typeof input !== "object") throw new ResearchFundReportError("invalid_input");
  const body = input as Record<string, unknown>;
  return {
    title: text(body.title, FUND_REPORT_LIMITS.title, true) as string,
    body: text(body.body, FUND_REPORT_LIMITS.body, true) as string,
    amount: text(body.amount, FUND_REPORT_LIMITS.amount, false),
    evidenceUrl: httpsUrl(body.evidenceUrl),
  };
}

const select = `SELECT r.id,r.project_id projectId,r.title,r.body,r.amount,r.evidence_url evidenceUrl,r.created_at createdAt,r.updated_at updatedAt
  FROM research_fund_reports r`;

/** 閲覧できるプロジェクト（公開か本人のもの）の報告だけを新しい順に返す。 */
export async function listResearchFundReports(database: D1Database, projectId: string, viewerId?: string | null): Promise<ResearchFundReport[]> {
  const result = await database
    .prepare(`${select} JOIN research_projects p ON p.id=r.project_id WHERE r.project_id=? AND (p.visibility='public' OR p.owner_profile_id=?) ORDER BY r.created_at DESC,r.id DESC LIMIT 200`)
    .bind(projectId, viewerId ?? "")
    .all<ResearchFundReport>();
  return result.results ?? [];
}

async function assertOwner(database: D1Database, projectId: string, viewerId: string): Promise<void> {
  const row = await database.prepare("SELECT owner_profile_id ownerProfileId FROM research_projects WHERE id=?").bind(projectId).first<{ ownerProfileId: string }>();
  if (!row) throw new ResearchFundReportError("research_not_found");
  if (row.ownerProfileId !== viewerId) throw new ResearchFundReportError("research_forbidden");
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createResearchFundReport(database: D1Database, projectId: string, viewerId: string, input: unknown): Promise<ResearchFundReport> {
  await assertOwner(database, projectId, viewerId);
  const value = validateFundReportInput(input);
  const id = randomId();
  const now = new Date().toISOString();
  await database
    .prepare("INSERT INTO research_fund_reports(id,project_id,title,body,amount,evidence_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(id, projectId, value.title, value.body, value.amount, value.evidenceUrl, now, now)
    .run();
  return { id, projectId, ...value, createdAt: now, updatedAt: now };
}

export async function deleteResearchFundReport(database: D1Database, projectId: string, viewerId: string, reportId: string): Promise<void> {
  await assertOwner(database, projectId, viewerId);
  const existing = await database.prepare("SELECT id FROM research_fund_reports WHERE id=? AND project_id=?").bind(reportId, projectId).first<{ id: string }>();
  if (!existing) throw new ResearchFundReportError("report_not_found");
  await database.prepare("DELETE FROM research_fund_reports WHERE id=? AND project_id=?").bind(reportId, projectId).run();
}
