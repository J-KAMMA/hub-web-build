import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { isCopyrightParty } from "@/lib/server/copyright-case-views";
import { ExternalDecisionError, mintExternalDecision, type ExternalAction } from "@/lib/server/copyright-external";

/*
 * Music・Vault の対象についての運営の判断に、Hub が署名する（PLAN 6.5）。
 * 運営の権限と同一オリジンを確かめたあとにだけ署名し、トークンを返す。ブラウザはこれを
 * `path`（Rights Desk の /rights/api/v1/cases/{事件番号}/decisions）へ本文なしで POST する。
 * Hub のサーバーは Music を呼ばず、判断の中継もしない。反映の確認は /sync が Rights Desk の答えで行う。
 */
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const ACTIONS: readonly ExternalAction[] = ["open", "hide", "object", "restore", "finalize", "close"];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) || requireSameOrigin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) denied.headers.set(name, value);
    return denied;
  }
  const body = await request.json().catch(() => null) as {
    targetRowId?: unknown; action?: unknown; route?: unknown; immediateReason?: unknown; clearlyInfringing?: unknown; note?: unknown; outcome?: unknown; due?: unknown;
  } | null;
  if (!body || typeof body.targetRowId !== "string" || !ACTIONS.includes(body.action as ExternalAction)) return json({ error: "invalid_input" }, 400);
  // 事件の当事者（投稿者・申告者）は、その事件に運営として判断できない（PLAN 9.3）。
  const db = getHubD1();
  const viewer = await getOptionalHubSessionProfile(request, db).catch(() => null);
  if (await isCopyrightParty(db, body.targetRowId, viewer?.id)) return json({ error: "party", message: "この事件の当事者のため、操作できません。" }, 403);
  try {
    const minted = await mintExternalDecision(db, body.targetRowId, {
      action: body.action as ExternalAction,
      route: body.route === "inquiry" || body.route === "immediate" ? body.route : undefined,
      immediateReason: body.immediateReason,
      clearlyInfringing: body.clearlyInfringing === true,
      note: typeof body.note === "string" ? body.note : undefined,
      outcome: body.outcome === "kept" || body.outcome === "rejected" ? body.outcome : undefined,
      due: typeof body.due === "string" ? body.due : undefined,
    });
    return json(minted);
  } catch (error) {
    if (error instanceof ExternalDecisionError) {
      const status = error.code === "not_found" ? 404 : error.code === "unconfigured" ? 503 : error.code === "forbidden_transition" ? 409 : 400;
      return json({ error: error.code, message: error.message }, status);
    }
    throw error;
  }
}
