export const HUB_CORE_MODEL_VERSION = "hub.core.v1" as const;

export type HubActorKind =
  | "human"
  | "organization"
  | "community"
  | "agent"
  | "service";

export type HubObjectKind =
  | "post"
  | "thread"
  | "board"
  | "list"
  | "article"
  | "video"
  | "audio"
  | "product"
  | "job"
  | "project"
  | "property"
  | "vehicle"
  | "api"
  | "model"
  | "event"
  | "contract";

export type HubActionKind =
  | "create"
  | "reply"
  | "evaluate"
  | "save"
  | "purchase"
  | "hire"
  | "reserve"
  | "pay"
  | "delegate"
  | "vote";

export type HubApprovalMode = "not_required" | "required" | "granted" | "denied";

export interface HubScopedRef {
  namespace: string;
  kind: string;
  id: string;
}

export interface HubCoreEnvelope<TType extends string, TData> {
  version: typeof HUB_CORE_MODEL_VERSION;
  type: TType;
  id: string;
  occurredAt: string;
  data: TData;
}

export interface HubActor {
  ref: HubScopedRef;
  kind: HubActorKind;
  displayName: string;
  owner?: HubScopedRef;
  status: "active" | "suspended" | "deleted";
}

export interface HubObject {
  ref: HubScopedRef;
  kind: HubObjectKind;
  owner: HubScopedRef;
  visibility: "public" | "restricted" | "private";
  status: "draft" | "active" | "completed" | "archived" | "deleted";
}

export interface HubAction {
  kind: HubActionKind;
  actor: HubScopedRef;
  object: HubScopedRef;
  approval: HubApprovalMode;
}

export interface HubIntent {
  actor: HubScopedRef;
  objective: string;
  constraints: Record<string, string | number | boolean>;
  negotiable: string[];
  approvals: {
    publish: HubApprovalMode;
    contract: HubApprovalMode;
    payment: HubApprovalMode;
    personalData: HubApprovalMode;
  };
  expiresAt: string;
}

export interface HubCapability {
  name: string;
  provider: HubScopedRef;
  description: string;
  inputSchema: string;
  outputSchema: string;
  permissions: string[];
  cost: {
    mode: "free" | "fixed" | "metered" | "external";
    maximum?: string;
    currency?: string;
  };
  humanApproval: HubApprovalMode;
}

export interface HubRelationship {
  subject: HubScopedRef;
  predicate: string;
  object: HubScopedRef;
  visibility: "public" | "restricted" | "private";
  validFrom: string;
  validUntil?: string;
}

export interface HubEvent {
  name: string;
  actor: HubScopedRef;
  object?: HubScopedRef;
  correlationId: string;
  attributes: Record<string, string | number | boolean | null>;
}

export interface HubPermission {
  subject: HubScopedRef;
  capability: string;
  resource: HubScopedRef;
  effect: "allow" | "deny";
  constraints: Record<string, string | number | boolean>;
  expiresAt: string;
  delegation: "forbidden" | "same-scope";
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_NAMESPACE = /^[a-z][a-z0-9.-]{0,62}$/;
const CAPABILITY_NAME = /^hub\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export function isHubScopedRef(value: unknown): value is HubScopedRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Partial<HubScopedRef>;
  return typeof ref.namespace === "string"
    && SAFE_NAMESPACE.test(ref.namespace)
    && typeof ref.kind === "string"
    && SAFE_NAMESPACE.test(ref.kind)
    && typeof ref.id === "string"
    && SAFE_ID.test(ref.id);
}

export function validateHubIntent(intent: HubIntent): string[] {
  const issues: string[] = [];
  if (!isHubScopedRef(intent.actor)) issues.push("actor must be a scoped opaque reference");
  if (!CAPABILITY_NAME.test(intent.objective)) issues.push("objective must be a version-independent Hub capability name");
  if (!intent.expiresAt || Number.isNaN(Date.parse(intent.expiresAt))) issues.push("expiresAt must be an ISO date");
  if (Date.parse(intent.expiresAt) <= Date.now()) issues.push("intent must not already be expired");
  const commerceRequired = intent.constraints.commerceRequired === true;
  if (commerceRequired && intent.approvals.payment === "not_required") {
    issues.push("payment approval must be required or explicitly granted");
  }
  if (commerceRequired && intent.approvals.contract === "not_required") {
    issues.push("contract approval must be required or explicitly granted");
  }
  return issues;
}

export function validateHubPermission(permission: HubPermission): string[] {
  const issues: string[] = [];
  if (!isHubScopedRef(permission.subject)) issues.push("subject must be a scoped opaque reference");
  if (!isHubScopedRef(permission.resource)) issues.push("resource must be a scoped opaque reference");
  if (!CAPABILITY_NAME.test(permission.capability)) issues.push("capability must use the Hub capability namespace");
  if (!permission.expiresAt || Number.isNaN(Date.parse(permission.expiresAt))) issues.push("expiresAt must be an ISO date");
  if (permission.delegation !== "forbidden") issues.push("v1 permissions must forbid re-delegation");
  return issues;
}

export function canExecuteHubAction(action: HubAction): boolean {
  return isHubScopedRef(action.actor)
    && isHubScopedRef(action.object)
    && (action.approval === "not_required" || action.approval === "granted");
}
