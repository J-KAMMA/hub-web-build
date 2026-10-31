import { NextResponse } from "next/server";

import { gateTokenMetaDeps, readGateTokenMeta } from "@/lib/server/access-gate-token-meta";
import { NO_STORE, accessGateErrorResponse, readJson, rejectCrossOrigin } from "@/lib/server/access-gates-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

const MESSAGES = {
  invalid_input: "チェーン・種類・コントラクトアドレスを確かめてください。",
  unsupported_chain: "このチェーンは閲覧条件に使えません。",
  unavailable: "トークンの情報を読み取れませんでした。しばらくしてからお試しください。",
  not_found: "このアドレスにトークンが見つかりませんでした。チェーンとアドレスを確かめてください。",
  wrong_kind: "選んだ種類のトークンではないようです。種類を確かめてください。",
} as const;

/** 閲覧条件の作成者が、選んだトークンの名前・記号・桁数を確かめる（読み取り専用。ログイン必須）。 */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    await requireHubSessionProfile(request, getHubD1());
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const result = await readGateTokenMeta(
      { kind: body?.kind, chainId: body?.chainId, contract: body?.contract },
      gateTokenMetaDeps(),
    );
    if (result.ok) return NextResponse.json({ meta: result.meta }, { headers: NO_STORE });
    const status = result.reason === "unavailable" ? 503 : result.reason === "not_found" || result.reason === "wrong_kind" ? 404 : 400;
    return NextResponse.json({ error: MESSAGES[result.reason], reason: result.reason }, { status, headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}
