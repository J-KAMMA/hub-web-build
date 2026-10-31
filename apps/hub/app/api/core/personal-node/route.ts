import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  appendPersonalNodeEvent,
  completePersonalNodeDeviceRegistration,
  completePersonalNodeRegistration,
  completePersonalNodeRootKeyRotation,
  completePersonalNodeRecoverySetup,
  completePersonalNodeRootKeyRecovery,
  getPersonalNodeState,
  getPersonalNodeEventHead,
  revokePersonalNode,
  revokePersonalNodeDevice,
  setPersonalNodeRelays,
  startPersonalNodeChallenge,
  startPersonalNodeDeviceChallenge,
  startPersonalNodeRootKeyRotation,
  startPersonalNodeRecoverySetup,
  startPersonalNodeRootKeyRecovery,
} from "@/lib/server/federation-gateway";
import { ingestPersonalNodeTranslation } from "@/lib/server/post-translation";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const state = await getPersonalNodeState(profile.id);
    return state
      ? NextResponse.json(state, { headers: responseHeaders })
      : NextResponse.json({ error: "personal_node_unavailable" }, { status: 503, headers: responseHeaders });
  } catch (error) {
    return authError(error);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: responseHeaders });
  }
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action === "challenge") {
      if (typeof body.nodeUrl !== "string" || typeof body.publicKeyJwk !== "object") return invalid();
      const result = await startPersonalNodeChallenge({
        profileId: profile.id,
        nodeUrl: body.nodeUrl,
        publicKeyJwk: body.publicKeyJwk,
      });
      return gatewayResult(result);
    }
    if (body?.action === "register") {
      if (typeof body.challengeId !== "string" || typeof body.signature !== "string") return invalid();
      return gatewayResult(await completePersonalNodeRegistration({
        profileId: profile.id,
        challengeId: body.challengeId,
        signature: body.signature,
      }));
    }
    if (body?.action === "event") {
      if (typeof body.event !== "object" || typeof body.signature !== "string") return invalid();
      const accepted = await appendPersonalNodeEvent(
        profile.id,
        body.event,
        body.signature,
        typeof body.keyId === "string" ? body.keyId : "root",
      );
      if (!accepted) return gatewayResult(null);
      const event = body.event as { type?: unknown; payload?: unknown };
      if (event.type === "hub.translation.publish") {
        const ingested = await ingestPersonalNodeTranslation(profile.id, event.payload);
        if (!ingested) {
          return NextResponse.json(
            { ...accepted, translationIngested: false },
            { status: 202, headers: responseHeaders },
          );
        }
      }
      return gatewayResult(accepted);
    }
    if (body?.action === "event_head") {
      return gatewayResult(await getPersonalNodeEventHead(profile.id));
    }
    if (body?.action === "device_challenge") {
      if (typeof body.label !== "string" || typeof body.deviceType !== "string" ||
          typeof body.publicKeyJwk !== "object" || !Array.isArray(body.scopes) ||
          body.scopes.some((scope) => typeof scope !== "string")) return invalid();
      return gatewayResult(await startPersonalNodeDeviceChallenge({
        profileId: profile.id,
        label: body.label,
        deviceType: body.deviceType,
        publicKeyJwk: body.publicKeyJwk,
        scopes: body.scopes,
      }));
    }
    if (body?.action === "device_register") {
      if (typeof body.challengeId !== "string" || typeof body.signature !== "string") return invalid();
      return gatewayResult(await completePersonalNodeDeviceRegistration({
        profileId: profile.id,
        challengeId: body.challengeId,
        signature: body.signature,
      }));
    }
    if (body?.action === "root_key_rotation_start") {
      if (typeof body.idempotencyKey !== "string" ||
          typeof body.newPublicKeyJwk !== "object") return invalid();
      return gatewayResult(await startPersonalNodeRootKeyRotation({
        profileId: profile.id,
        idempotencyKey: body.idempotencyKey,
        newPublicKeyJwk: body.newPublicKeyJwk,
      }));
    }
    if (body?.action === "root_key_rotation_complete") {
      if (typeof body.rotationId !== "string" ||
          typeof body.oldSignature !== "string" ||
          typeof body.newSignature !== "string") return invalid();
      return gatewayResult(await completePersonalNodeRootKeyRotation({
        profileId: profile.id,
        rotationId: body.rotationId,
        oldSignature: body.oldSignature,
        newSignature: body.newSignature,
      }));
    }
    if (body?.action === "recovery_setup_start") {
      if (typeof body.idempotencyKey !== "string" ||
          !Number.isSafeInteger(body.threshold) || !Array.isArray(body.keys) ||
          body.keys.some((key) => typeof key !== "object" || key === null)) return invalid();
      return gatewayResult(await startPersonalNodeRecoverySetup({
        profileId: profile.id,
        idempotencyKey: body.idempotencyKey,
        threshold: Number(body.threshold),
        keys: body.keys as Array<{ label: string; publicKeyJwk: unknown }>,
      }));
    }
    if (body?.action === "recovery_setup_complete") {
      if (typeof body.setupId !== "string" || typeof body.signature !== "string") return invalid();
      return gatewayResult(await completePersonalNodeRecoverySetup({
        profileId: profile.id,
        setupId: body.setupId,
        signature: body.signature,
      }));
    }
    if (body?.action === "recovery_start") {
      if (typeof body.idempotencyKey !== "string" ||
          typeof body.newPublicKeyJwk !== "object") return invalid();
      return gatewayResult(await startPersonalNodeRootKeyRecovery({
        profileId: profile.id,
        idempotencyKey: body.idempotencyKey,
        newPublicKeyJwk: body.newPublicKeyJwk,
      }));
    }
    if (body?.action === "recovery_complete") {
      if (typeof body.recoveryId !== "string" || typeof body.newSignature !== "string" ||
          !Array.isArray(body.signatures) ||
          body.signatures.some((signature) => typeof signature !== "object" || signature === null)) {
        return invalid();
      }
      return gatewayResult(await completePersonalNodeRootKeyRecovery({
        profileId: profile.id,
        recoveryId: body.recoveryId,
        newSignature: body.newSignature,
        signatures: body.signatures as Array<{ recoveryKeyId: string; signature: string }>,
      }));
    }
    return invalid();
  } catch (error) {
    return authError(error);
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: responseHeaders });
  }
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null) as { relays?: unknown } | null;
    if (!Array.isArray(body?.relays) ||
        body.relays.some((url) => typeof url !== "string")) return invalid();
    return gatewayResult(await setPersonalNodeRelays(
      profile.id,
      body.relays.map((url) => ({ url: String(url) })),
    ));
  } catch (error) {
    return authError(error);
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: responseHeaders });
  }
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const deviceId = new URL(request.url).searchParams.get("deviceId");
    if (deviceId) {
      return await revokePersonalNodeDevice(profile.id, deviceId)
        ? NextResponse.json({ revoked: true }, { headers: responseHeaders })
        : NextResponse.json({ error: "device_not_found" }, { status: 404, headers: responseHeaders });
    }
    return await revokePersonalNode(profile.id)
      ? NextResponse.json({ revoked: true }, { headers: responseHeaders })
      : NextResponse.json({ error: "personal_node_unavailable" }, { status: 503, headers: responseHeaders });
  } catch (error) {
    return authError(error);
  }
}

function gatewayResult(value: unknown | null) {
  return value
    ? NextResponse.json(value, { headers: responseHeaders })
    : NextResponse.json({ error: "personal_node_request_failed" }, { status: 409, headers: responseHeaders });
}

function invalid() {
  return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: responseHeaders });
}

function authError(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: responseHeaders });
  }
  return NextResponse.json({ error: "personal_node_unavailable" }, { status: 503, headers: responseHeaders });
}
