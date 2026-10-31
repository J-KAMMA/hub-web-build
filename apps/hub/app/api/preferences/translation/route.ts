import { NextResponse } from "next/server";

import { isTranslationSourceLanguage } from "@/lib/translation-preference";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { listD1TranslationPreferences, setD1TranslationPreference } from "@/lib/server/d1-translation-preferences";

function failure(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }
  return NextResponse.json({ error: "翻訳設定を取得できませんでした。" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({ languages: await listD1TranslationPreferences(database, viewer.id) });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const payload = await request.json() as { language?: unknown; enabled?: unknown };
    if (!isTranslationSourceLanguage(payload.language) || typeof payload.enabled !== "boolean") {
      return NextResponse.json({ error: "翻訳表示の設定が正しくありません。" }, { status: 400 });
    }
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    await setD1TranslationPreference(database, viewer.id, payload.language, payload.enabled);
    return NextResponse.json({ language: payload.language, enabled: payload.enabled });
  } catch (error) {
    return failure(error);
  }
}
