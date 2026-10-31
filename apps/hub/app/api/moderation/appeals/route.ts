import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";

import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  HubAuthenticationError,
  HubSuspendedError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

type AppealRow = {
  id: string;
  message: string;
  status: "open" | "accepted" | "rejected";
  resolutionNote: string;
  createdAt: string;
  resolvedAt: string | null;
};

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

function privateJson(body: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...PRIVATE_HEADERS, ...init.headers },
  });
}

async function listAppeals(database: D1Database, profileId: string) {
  const result = await database.prepare(`SELECT
    id,message,status,resolution_note AS resolutionNote,
    created_at AS createdAt,resolved_at AS resolvedAt
    FROM moderation_appeals
    WHERE profile_id=?
    ORDER BY created_at DESC
    LIMIT 20`).bind(profileId).all<AppealRow>();
  return result.results;
}

export async function GET(request: Request) {
  const database = getHubD1();
  try {
    const profile = await requireHubSessionProfile(request, database);
    return privateJson({
      eligible: false,
      suspensionReason: "",
      appeals: await listAppeals(database, profile.id),
    });
  } catch (error) {
    if (error instanceof HubSuspendedError) {
      const moderation = await database.prepare(
        "SELECT reason,updated_at AS updatedAt FROM profile_moderation_status WHERE profile_id=? AND status='suspended'",
      ).bind(error.profile.id).first<{ reason: string; updatedAt: string }>();
      return privateJson({
        eligible: true,
        suspensionReason: moderation?.reason ?? "",
        suspendedAt: moderation?.updatedAt ?? null,
        appeals: await listAppeals(database, error.profile.id),
      });
    }
    if (error instanceof HubAuthenticationError) {
      return privateJson({ error: "ログインが必要です。" }, { status: 401 });
    }
    return privateJson({ error: "異議申立ての状態を取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return privateJson({ error: "不正なリクエストです。" }, { status: 403 });
  }
  const database = getHubD1();

  let profile;
  try {
    profile = await requireHubSessionProfile(request, database);
    return privateJson({ error: "停止中のプロフィールだけが利用できます。" }, { status: 409 });
  } catch (error) {
    if (error instanceof HubSuspendedError) profile = error.profile;
    else if (error instanceof HubAuthenticationError) {
      return privateJson({ error: "ログインが必要です。" }, { status: 401 });
    } else throw error;
  }

  const body = await request.json().catch(() => null) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < 20 || message.length > 2000) {
    return privateJson({ error: "20〜2000文字で入力してください。" }, { status: 400 });
  }

  const existing = await database.prepare(`SELECT id,status,created_at AS createdAt
    FROM moderation_appeals
    WHERE profile_id=? AND status='open'
    LIMIT 1`).bind(profile.id).first<{ id: string; status: string; createdAt: string }>();
  if (existing) {
    return privateJson({
      submitted: true,
      duplicate: true,
      appeal: { id: existing.id, status: existing.status, createdAt: existing.createdAt },
    });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await database.prepare(
      "INSERT INTO moderation_appeals(id,profile_id,message,status,created_at) VALUES(?,?,?,'open',?)",
    ).bind(id, profile.id, message, now).run();
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (text.includes("appeal_rate_limit")) {
      return privateJson(
        { error: "異議申立ての送信上限に達しました。審査結果をお待ちください。" },
        { status: 429, headers: { "Retry-After": "86400" } },
      );
    }
    if (text.includes("UNIQUE")) {
      return privateJson({ submitted: true, duplicate: true }, { status: 200 });
    }
    throw error;
  }
  return privateJson({
    submitted: true,
    duplicate: false,
    appeal: { id, status: "open", createdAt: now },
  }, { status: 201 });
}
