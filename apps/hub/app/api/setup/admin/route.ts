import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";

import { HubAuthInputError, HubHandleConflictError } from "@/lib/server/hub-auth";
import {
  clearHubPasskeyCeremonyCookie,
  hasSameOrigin,
  setHubPasskeyCeremonyCookie,
  setHubSessionCookie,
} from "@/lib/server/hub-auth-route";
import {
  claimFirstAdmin,
  isBootstrapAvailable,
  recordBootstrapFailure,
  tokenMatches,
} from "@/lib/server/hub-bootstrap";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { beginPasskeyRegistration, finishPasskeyRegistration, HubPasskeyError } from "@/lib/server/hub-passkeys";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

/** Every refusal looks the same: this setup does not exist unless the token is right and no admin exists. */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

/*
 * POST { step: "options", token, handle, displayName } -> passkey registration options
 * POST { step: "verify", token, response }             -> registers the passkey and makes the profile the first operator
 * The token is checked again on every step. It is never logged or echoed.
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
  const database = getOptionalHubD1();
  if (!database) return notFound();
  if (!(await isBootstrapAvailable(database))) return notFound();
  const body = await request.json().catch(() => null) as {
    step?: unknown;
    token?: unknown;
    handle?: unknown;
    displayName?: unknown;
    response?: unknown;
  } | null;
  if (!body) return notFound();
  if (!(await tokenMatches(body.token))) {
    await recordBootstrapFailure(database);
    return notFound();
  }

  try {
    if (body.step === "options") {
      if (typeof body.handle !== "string" || typeof body.displayName !== "string") {
        return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers: NO_STORE });
      }
      const result = await beginPasskeyRegistration(database, request, {
        handle: body.handle,
        displayName: body.displayName,
      });
      const response = NextResponse.json({ options: result.options }, { headers: NO_STORE });
      setHubPasskeyCeremonyCookie(response, request, result.cookieValue, result.expiresAt);
      return response;
    }
    if (body.step === "verify") {
      const passkey = body.response as RegistrationResponseJSON | null;
      if (!passkey || typeof passkey.id !== "string" || passkey.type !== "public-key") {
        return NextResponse.json({ error: "パスキー応答を確認できません。" }, { status: 400, headers: NO_STORE });
      }
      const result = await finishPasskeyRegistration(database, request, passkey);
      if (!(await claimFirstAdmin(database, result.profile.id))) {
        // Lost a race with another visitor holding the same token: this profile stays an ordinary one.
        await database.prepare("DELETE FROM sessions WHERE profile_id = ?").bind(result.profile.id).run();
        return notFound();
      }
      const response = NextResponse.json({ profile: result.profile, operator: true }, { status: 201, headers: NO_STORE });
      clearHubPasskeyCeremonyCookie(response, request);
      setHubSessionCookie(response, request, result.sessionSecret, result.expiresAt);
      return response;
    }
    return notFound();
  } catch (error) {
    if (error instanceof HubHandleConflictError) {
      return NextResponse.json({ error: "そのユーザーIDは使用されています。" }, { status: 409, headers: NO_STORE });
    }
    if (error instanceof HubAuthInputError || error instanceof HubPasskeyError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
    }
    return NextResponse.json({ error: "処理できませんでした。" }, { status: 500, headers: NO_STORE });
  }
}
