export type HubRuntimeEnvironment = "development" | "staging" | "production";

const allowed = new Set<HubRuntimeEnvironment>(["development", "staging", "production"]);

export function getHubRuntimeEnvironment(
  value: string | undefined = process.env.HUB_DEPLOYMENT_ENVIRONMENT,
  runtime: string | undefined = process.env.CLOUDFLARE_RUNTIME,
): HubRuntimeEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized && allowed.has(normalized as HubRuntimeEnvironment)) {
    return normalized as HubRuntimeEnvironment;
  }
  // A local Node runtime is always development, even though `next build` sets
  // NODE_ENV=production. Workers must declare their environment explicitly.
  if (runtime !== "workers") return "development";
  throw new Error("HUB_DEPLOYMENT_ENVIRONMENT must be development, staging, or production");
}

export function getHubRuntimeEnvironmentLabel(environment: HubRuntimeEnvironment, locale = "ja") {
  if (locale === "ja") {
    return environment === "development" ? "開発" : environment === "staging" ? "ステージング" : "本番";
  }
  return environment === "development" ? "Development" : environment === "staging" ? "Staging" : "Production";
}

export function assertHubRuntimeEnvironmentConfiguration(input: {
  environment: HubRuntimeEnvironment;
  runtime?: string;
  publicOrigin?: string;
  workerName?: string;
}) {
  if (input.runtime !== "workers") {
    if (input.environment !== "development") {
      throw new Error("Non-Workers Hub runtimes must use the development environment");
    }
    return;
  }

  const origin = new URL(input.publicOrigin ?? "");
  const workerName = input.workerName?.trim() ?? "";
  if (input.environment === "staging") {
    if (!workerName.endsWith("-staging") || !origin.hostname.includes("staging")) {
      throw new Error("Staging Hub resources and origin must be staging-specific");
    }
    return;
  }
  if (input.environment === "production") {
    if (workerName.includes("staging") || origin.origin !== "https://hub.jkamma.com") {
      throw new Error("Production Hub must use the reviewed production name and https://hub.jkamma.com");
    }
    return;
  }
  throw new Error("Workers cannot run with development resources");
}
