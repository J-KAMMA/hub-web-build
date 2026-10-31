import type { HubAction } from "@/lib/platform/core-model";
import { canExecuteHubAction, isHubScopedRef } from "@/lib/platform/core-model";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";

export const CREATE_SOCIAL_POST_CAPABILITY = "hub.social.post.create" as const;

export interface CreateSocialPostCoreActionRequest {
  capability: typeof CREATE_SOCIAL_POST_CAPABILITY;
  action: HubAction & {
    kind: "create";
  };
  input: {
    body: string;
    audience: "public" | "followers";
    imageIds: string[];
    clientRequestId: string | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseCreateSocialPostCoreAction(
  value: unknown,
): CreateSocialPostCoreActionRequest | null {
  if (!isRecord(value) || value.capability !== CREATE_SOCIAL_POST_CAPABILITY) {
    return null;
  }
  if (!isRecord(value.action) || !isRecord(value.input)) return null;

  const action: HubAction = {
    kind: value.action.kind as HubAction["kind"],
    actor: value.action.actor as HubAction["actor"],
    object: value.action.object as HubAction["object"],
    approval: value.action.approval as HubAction["approval"],
  };
  if (
    action.kind !== "create"
    || action.approval !== "granted"
    || !canExecuteHubAction(action)
    || action.actor.namespace !== "hub"
    || action.actor.kind !== "profile"
    || action.object.namespace !== "hub"
    || action.object.kind !== "post"
  ) {
    return null;
  }

  const body = typeof value.input.body === "string" ? value.input.body.trim() : "";
  if (!body || body.length > HUB_SOCIAL_POST_MAX_CHARACTERS) return null;
  const audience = value.input.audience === "followers" ? "followers" : "public";
  const imageIds = Array.isArray(value.input.imageIds)
    ? value.input.imageIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128,
      )
    : [];
  if (imageIds.length > 4) return null;
  const clientRequestId =
    typeof value.input.clientRequestId === "string"
      ? value.input.clientRequestId.trim()
      : null;
  if (clientRequestId && !/^[0-9a-f-]{36}$/i.test(clientRequestId)) return null;

  return {
    capability: CREATE_SOCIAL_POST_CAPABILITY,
    action: {
      kind: "create",
      actor: action.actor,
      object: action.object,
      approval: "granted",
    },
    input: { body, audience, imageIds, clientRequestId },
  };
}

export function isCoreActionActor(
  value: CreateSocialPostCoreActionRequest,
  hubProfileId: string,
) {
  return isHubScopedRef(value.action.actor)
    && value.action.actor.id === hubProfileId;
}
