import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getHubRuntimeEnvironment } from "@/lib/runtime-environment";

export function getServerHubRuntimeEnvironment() {
  if (process.env.CLOUDFLARE_RUNTIME !== "workers") {
    return getHubRuntimeEnvironment();
  }
  try {
    const environment = getCloudflareContext().env as unknown as Record<string, unknown>;
    const value = typeof environment.HUB_DEPLOYMENT_ENVIRONMENT === "string"
      ? environment.HUB_DEPLOYMENT_ENVIRONMENT
      : process.env.HUB_DEPLOYMENT_ENVIRONMENT;
    return getHubRuntimeEnvironment(value, "workers");
  } catch {
    // Fail closed instead of presenting a Workers deployment as production.
    return getHubRuntimeEnvironment(process.env.HUB_DEPLOYMENT_ENVIRONMENT, "workers");
  }
}
