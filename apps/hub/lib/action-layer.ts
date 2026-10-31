export const HUB_ACTION_TYPES = [
  "purchase",
  "apply",
  "accept_task",
  "execute_ai",
  "use_dataset",
  "submit_compute",
  "join_research",
  "view_listing",
  "join_event",
  "purchase_gohotoken",
  "acquire_vault",
  "read_hubpedia",
] as const;

export type HubActionType = (typeof HUB_ACTION_TYPES)[number];
export type HubActionStatus = "available" | "unavailable" | "read_only";
export const HUB_ACTION_OWNERS = [
  "commerce", "hub", "ai", "vault", "gohotoken", "hubpedia",
  "data", "compute", "research", "listings",
] as const;
export type HubActionOwner = (typeof HUB_ACTION_OWNERS)[number];
const HUB_ACTION_STATUSES = ["available", "unavailable", "read_only"] as const;

export interface HubActionProjection {
  type: HubActionType;
  publicResourceRef: string;
  ownerService: HubActionOwner;
  projectionVersion: string;
  label: string;
  title: string;
  description?: string;
  imageUrl?: string | null;
  priceLabel?: string | null;
  href: string | null;
  status: HubActionStatus;
  statusLabel?: string;
}

const PUBLIC_RESOURCE_REF = /^[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._~-]{1,160}$/;
const VERSION = /^[1-9][0-9]{0,5}$/;

function clean(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isSafeHref(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function publicResourceToken(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function createHubActionProjection(input: HubActionProjection): HubActionProjection {
  if (!HUB_ACTION_TYPES.includes(input.type)) throw new Error("Unsupported Hub action type.");
  if (!HUB_ACTION_OWNERS.includes(input.ownerService)) throw new Error("Unsupported owner service.");
  if (!HUB_ACTION_STATUSES.includes(input.status)) throw new Error("Unsupported action status.");
  if (!PUBLIC_RESOURCE_REF.test(input.publicResourceRef)) throw new Error("Invalid public resource reference.");
  if (!VERSION.test(input.projectionVersion)) throw new Error("Invalid projection version.");
  if (!input.href && input.status === "available") throw new Error("Available actions require a destination.");
  if (input.href && !isSafeHref(input.href)) throw new Error("Unsafe action destination.");
  if (input.imageUrl && !isSafeHref(input.imageUrl)) throw new Error("Unsafe action image.");

  return {
    ...input,
    label: clean(input.label, 48),
    title: clean(input.title, 160),
    description: input.description ? clean(input.description, 320) : undefined,
    priceLabel: input.priceLabel ? clean(input.priceLabel, 64) : null,
    statusLabel: input.statusLabel ? clean(input.statusLabel, 80) : undefined,
    href: input.status === "available" ? input.href : null,
  };
}

export function isHubActionProjection(value: unknown): value is HubActionProjection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HubActionProjection>;
  try {
    createHubActionProjection(candidate as HubActionProjection);
    return true;
  } catch {
    return false;
  }
}
