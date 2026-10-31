import { NextResponse } from "next/server";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { CopyrightCaseError, respondToCase, type SenderResponseKind } from "@/lib/server/copyright-cases";
import { loadAuthorCase } from "@/lib/server/copyright-case-views";
import { composeObjectionBody, validateObjection } from "@/lib/copyright-case-ui";

/*
 * 投稿者の回答。[id] は事件の ID。本人（対象の投稿者）だけが出せる。本人以外には、事件があるかどうかも知らせない（404）。
 *   agree     : 措置に同意する（自分で非公開にする）
 *   object    : 同意しない（照会中）。非公開になったあとなら、異議になる。理由の種類・20字以上の理由・確認事項が要る。
 * 締切の判定は respondToCase が時計で行う（締切の瞬間から拒む）。
 */
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const STATUS: Record<string, number> = {
  not_found: 404, invalid_input: 400, deadline_passed: 409, conflict: 409, forbidden_transition: 409, forbidden: 403,
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: PRIVATE });
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE });
  try {
    const profile = await requireHubSessionProfile(request, db);
    const { id } = await params;
    const body = await request.json().catch(() => null) as {
      targetRowId?: unknown; response?: unknown; reason?: unknown; text?: unknown; attested?: unknown;
    } | null;
    if (!body || typeof body.targetRowId !== "string" || (body.response !== "agree" && body.response !== "object")) {
      return NextResponse.json({ error: "入力を確認してください。" }, { status: 400, headers: PRIVATE });
    }
    // 事件の ID と対象が本人のものか。違えば、あるかどうかも知らせない。
    const view = await loadAuthorCase(db, id, profile.id);
    const target = view?.targets.find((t) => t.id === body.targetRowId);
    if (!view || !target) return NextResponse.json({ error: "申告が見つかりません。" }, { status: 404, headers: PRIVATE });

    let kind: SenderResponseKind = "agree";
    let text = "";
    if (body.response === "object") {
      const reason = typeof body.reason === "string" ? body.reason : "";
      text = typeof body.text === "string" ? body.text.trim() : "";
      const invalid = validateObjection({ reason, text, attested: body.attested === true });
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400, headers: PRIVATE });
      kind = target.state === "hidden" ? "post_hide_objection" : "disagree";
      text = composeObjectionBody(reason, text);
    }
    const state = await respondToCase(db, { targetRowId: target.id, authorProfileId: profile.id, kind, body: text });
    return NextResponse.json({ ok: true, state }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE });
    if (error instanceof CopyrightCaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS[error.code] ?? 400, headers: PRIVATE });
    }
    throw error;
  }
}
