import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  cancelProfileDeletion,
  getProfileDeletionStatus,
  requestProfileDeletion,
} from "@/lib/server/profile-deletion";

/*
 * Profile deletion with a 30-day cancel window (owner decision 2026-10-17).
 *   GET     the current schedule, or { scheduled: false }
 *   POST    schedule the deletion (idempotent: asking again returns the live schedule)
 *   DELETE  cancel it, until the date and until the maintenance job has started
 * The deletion itself runs in the hourly maintenance job (lib/server/profile-deletion.ts).
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

function view(status: Awaited<ReturnType<typeof getProfileDeletionStatus>>) {
  return status
    ? { scheduled: true, requestedAt: status.requestedAt, executeAfter: status.executeAfter, state: status.state, canCancel: status.canCancel }
    : { scheduled: false };
}

export async function GET(request: Request) {
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503, headers: NO_STORE });
  try {
    const profile = await requireHubSessionProfile(request, db);
    return NextResponse.json(view(await getProfileDeletionStatus(db, profile.id)), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
    throw error;
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  try {
    const profile = await requireHubSessionProfile(request, db);
    const status = await requestProfileDeletion(db, profile.id);
    return NextResponse.json({ requested: true, ...view(status) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  try {
    const profile = await requireHubSessionProfile(request, db);
    if (await cancelProfileDeletion(db, profile.id)) return NextResponse.json({ cancelled: true }, { headers: NO_STORE });
    const status = await getProfileDeletionStatus(db, profile.id);
    return NextResponse.json(
      { error: status ? "削除はすでに始まっているため、取り消せません。" : "取り消せる削除申請がありません。", ...view(status) },
      { status: 409, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
}
