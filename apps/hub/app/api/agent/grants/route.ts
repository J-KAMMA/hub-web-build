import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { AGENT_SCOPES, issueAgentGrant, type AgentScope } from "@/lib/server/agent-access";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  const db = getHubD1();
  const profile = await requireHubSessionProfile(request, db);
  const result = await db.prepare(`SELECT id, label, source, scopes, expires_at, created_at, last_used_at
    FROM hub_agent_grants WHERE profile_id = ? AND revoked_at IS NULL AND expires_at > ?
    ORDER BY datetime(created_at) DESC`).bind(profile.id, new Date().toISOString()).all();
  return NextResponse.json({ grants: result.results }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const db = getHubD1();
  const profile = await requireHubSessionProfile(request, db);
  const body = await request.json().catch(() => null) as {
    label?: string; source?: string; scopes?: string[];
  } | null;
  const allowedSources = new Set(["codex", "chatgpt", "claude", "local_ai", "custom"]);
  const scopes = (body?.scopes ?? []).filter((scope): scope is AgentScope =>
    AGENT_SCOPES.includes(scope as AgentScope));
  if (!body?.label?.trim() || !allowedSources.has(body.source ?? "") || scopes.length === 0) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }
  const grant = await issueAgentGrant(db, profile, {
    label: body.label.trim(), source: body.source!, scopes,
  });
  return NextResponse.json({
    ...grant,
    warning: "このトークンは再表示されません。Codexの環境変数へ保存してください。",
  }, { status: 201, headers: privateHeaders });
}
