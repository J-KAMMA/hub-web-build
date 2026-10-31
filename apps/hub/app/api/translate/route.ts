import { NextResponse } from "next/server";
import { z } from "zod";

import { HUB_LOCALES } from "@/lib/i18n";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { translatePublicPost } from "@/lib/server/post-translation";
import { consumeWindowQuota } from "@/lib/server/security-throttle";

const requestSchema = z.object({
  targetType: z.enum(["social_post", "thread_post", "community_message"]),
  targetId: z.string().trim().min(1).max(120),
  targetLocale: z.enum(HUB_LOCALES)
}).strict();

/** Provider calls per profile per hour. Cached translations are not counted. */
const TRANSLATE_PROVIDER_LIMIT_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const NO_STORE = { "Cache-Control": "private, no-store" };

class TranslationRateLimitedError extends Error {}

export async function POST(request: Request) {
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: "Invalid translation request." }, { status: 400 });
  }

  try {
    // Serving an already-cached translation stays public; only a provider call needs a signed-in viewer.
    const translation = await translatePublicPost(
      input.data.targetType,
      input.data.targetId,
      input.data.targetLocale,
      async () => {
        const database = getHubD1();
        const profile = await requireHubViewerProfile(request, database);
        const allowed = await consumeWindowQuota(
          database, "translate_provider", profile.id, TRANSLATE_PROVIDER_LIMIT_PER_HOUR, HOUR_MS,
        );
        if (!allowed) throw new TranslationRateLimitedError();
      },
    );
    return NextResponse.json({ translation }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "Sign in to translate this post." }, { status: 401, headers: NO_STORE });
    }
    if (error instanceof TranslationRateLimitedError) {
      return NextResponse.json({ error: "Too many translation requests." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "3600" } });
    }
    return NextResponse.json(
      { error: "Translation is temporarily unavailable." },
      { status: 503, headers: NO_STORE }
    );
  }
}
