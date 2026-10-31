import { NextResponse } from "next/server";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { handleRightsDeskIntake } from "@/lib/server/copyright-cases";
import { authenticateRightsDeskRequest } from "@/lib/server/rights-desk-boundary";

/*
 * Rights Desk（apps/rights）からの申告の受け口。対象 1 件につき 1 要求（Music・Vault の対象も含む）。PLAN 6.5。
 * Authorization: Bearer の短命・1 回きりの署名つきトークン（rights.open）だけで認可する。cookie は見ない。
 * 鍵が未設定なら 503、署名・寿命・用途・jti の再利用の失敗は 401（jti を記録できないときは 503）。何も書かない。
 * 権限はトークンの claims だけで決まり、本文では広がらない。連絡先は要求にも応答にも入らない。
 * 同じ case と target の再送には 200 で既存の状態を返す。
 */
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE });
  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413, headers: PRIVATE });
  const auth = await authenticateRightsDeskRequest(db, request.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 503 ? "unavailable" : "unauthorized" }, { status: auth.status, headers: PRIVATE });
  const result = await handleRightsDeskIntake(db, auth.claims, rawBody);
  return NextResponse.json(result.body, { status: result.status, headers: PRIVATE });
}
