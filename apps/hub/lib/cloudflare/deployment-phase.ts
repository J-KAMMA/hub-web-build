export type CloudflareDeploymentPhase = "scaffold" | "ready";

export function getCloudflareDeploymentPhase(
  value: string | undefined = process.env.CLOUDFLARE_DEPLOYMENT_PHASE
): CloudflareDeploymentPhase {
  return value === "ready" ? "ready" : "scaffold";
}

export function isCloudflarePublicTrafficEnabled(value?: string) {
  return getCloudflareDeploymentPhase(value) === "ready";
}

export function shouldBlockCloudflareTraffic(
  runtime: string | undefined = process.env.CLOUDFLARE_RUNTIME,
  phase: string | undefined = process.env.CLOUDFLARE_DEPLOYMENT_PHASE
) {
  if (runtime !== "workers") {
    return false;
  }

  return !isCloudflarePublicTrafficEnabled(phase);
}
