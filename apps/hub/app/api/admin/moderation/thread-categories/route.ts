import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const authError = requireModerationAdmin(request);
  if (authError) return authError;
  const body = await request.json() as { action?: string; value?: number };
  if (body.action === "set_report_threshold") {
    const value = Math.trunc(Number(body.value));
    if (value < 3 || value > 10) return NextResponse.json({ error: "基準は3〜10件で指定してください。" }, { status: 400 });
    await getHubD1().prepare(`INSERT INTO thread_safety_settings(setting_key,setting_value,updated_at) VALUES('auto_hide_report_threshold',?,?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at`)
      .bind(value, new Date().toISOString()).run();
    return NextResponse.json({ value });
  }
  if (!["archive_mocks", "restore_mocks"].includes(body.action ?? "")) return NextResponse.json({ error: "操作が正しくありません。" }, { status: 400 });
  const status = body.action === "archive_mocks" ? "archived" : "open";
  const result = await getHubD1().prepare("UPDATE threads SET status=?, updated_at=? WHERE id LIKE 'category-mock-%'")
    .bind(status, new Date().toISOString()).run();
  return NextResponse.json({ changed: Number(result.meta.changes ?? 0), status });
}
