export type HubFeatureFlagDefinition = {
  key: string;
  description: string;
  defaultValue: boolean;
  owner: string;
};

export interface HubFeatureFlagProvider {
  getBoolean(key: string): boolean | undefined | Promise<boolean | undefined>;
}

const registry = new Map<string, HubFeatureFlagDefinition>();

export function registerHubFeatureFlags(definitions: readonly HubFeatureFlagDefinition[]) {
  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9-]+)+$/.test(definition.key)) throw new TypeError(`Invalid feature flag key: ${definition.key}`);
    if (registry.has(definition.key)) throw new Error(`Feature flag is already registered: ${definition.key}`);
    registry.set(definition.key, Object.freeze({ ...definition }));
  }
}

export function listHubFeatureFlags() {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function resolveHubFeatureFlag(key: string, provider?: HubFeatureFlagProvider): Promise<boolean> {
  const definition = registry.get(key);
  if (!definition) throw new Error(`Unknown feature flag: ${key}`);
  try {
    return (await provider?.getBoolean(key)) ?? definition.defaultValue;
  } catch {
    return definition.defaultValue;
  }
}

registerHubFeatureFlags([
  { key: "social.posting", description: "Allows authenticated profiles to create social posts.", defaultValue: true, owner: "hub-social" },
]);
