import type { HubCapability } from "@/lib/platform/core-model";

const SERVICE_NAME = /^external\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const CAPABILITY_NAME = /^hub\.external\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const PERMISSION = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

function publicHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (
      host === "localhost"
      || host === "0.0.0.0"
      || host === "::1"
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type DeveloperServiceInput = {
  serviceName: string;
  displayName: string;
  description: string;
  homepageUrl: string;
  privacyUrl: string;
  termsUrl: string;
  capability: {
    name: string;
    description: string;
    endpointUrl: string;
    httpMethod: "GET" | "POST";
    inputSchemaUrl: string;
    outputSchemaUrl: string;
    permissions: string[];
    costMode: "free" | "fixed" | "metered" | "external";
    humanApproval: "not_required" | "required";
  };
};

export function parseDeveloperServiceInput(value: unknown): DeveloperServiceInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const capability = input.capability && typeof input.capability === "object" && !Array.isArray(input.capability)
    ? input.capability as Record<string, unknown>
    : null;
  const serviceName = typeof input.serviceName === "string" ? input.serviceName.trim().toLowerCase() : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const homepageUrl = publicHttpsUrl(input.homepageUrl);
  const privacyUrl = publicHttpsUrl(input.privacyUrl);
  const termsUrl = publicHttpsUrl(input.termsUrl);
  const name = typeof capability?.name === "string" ? capability.name.trim().toLowerCase() : "";
  const capabilityDescription = typeof capability?.description === "string" ? capability.description.trim() : "";
  const endpointUrl = publicHttpsUrl(capability?.endpointUrl);
  const inputSchemaUrl = publicHttpsUrl(capability?.inputSchemaUrl);
  const outputSchemaUrl = publicHttpsUrl(capability?.outputSchemaUrl);
  const httpMethod = capability?.httpMethod === "GET" || capability?.httpMethod === "POST"
    ? capability.httpMethod
    : null;
  const permissions = Array.isArray(capability?.permissions)
    ? [...new Set(capability.permissions.filter((item): item is string =>
      typeof item === "string" && PERMISSION.test(item),
    ))].slice(0, 20)
    : [];
  const costMode = capability?.costMode === "free"
    || capability?.costMode === "fixed"
    || capability?.costMode === "metered"
    || capability?.costMode === "external"
    ? capability.costMode
    : null;
  const humanApproval = capability?.humanApproval === "not_required" || capability?.humanApproval === "required"
    ? capability.humanApproval
    : null;
  if (
    !SERVICE_NAME.test(serviceName)
    || !CAPABILITY_NAME.test(name)
    || displayName.length < 1 || displayName.length > 100
    || description.length < 20 || description.length > 2000
    || capabilityDescription.length < 20 || capabilityDescription.length > 1000
    || !homepageUrl || !privacyUrl || !termsUrl || !endpointUrl || !inputSchemaUrl || !outputSchemaUrl
    || !httpMethod || !costMode || !humanApproval || permissions.length === 0
  ) return null;
  if (!name.startsWith(`hub.${serviceName}.`)) return null;
  return {
    serviceName,
    displayName,
    description,
    homepageUrl,
    privacyUrl,
    termsUrl,
    capability: {
      name,
      description: capabilityDescription,
      endpointUrl,
      httpMethod,
      inputSchemaUrl,
      outputSchemaUrl,
      permissions,
      costMode,
      humanApproval,
    },
  };
}

export function developerCapabilityFromRow(row: Record<string, unknown>): HubCapability & {
  endpoint: { href: string; method: "GET" | "POST" };
  external: true;
} {
  return {
    name: String(row.capabilityName),
    provider: { namespace: "hub", kind: "service", id: String(row.serviceName) },
    description: String(row.capabilityDescription),
    inputSchema: String(row.inputSchemaUrl),
    outputSchema: String(row.outputSchemaUrl),
    permissions: JSON.parse(String(row.permissionsJson)) as string[],
    cost: { mode: String(row.costMode) as HubCapability["cost"]["mode"] },
    humanApproval: String(row.humanApproval) as HubCapability["humanApproval"],
    endpoint: {
      href: String(row.endpointUrl),
      method: String(row.httpMethod) as "GET" | "POST",
    },
    external: true,
  };
}
