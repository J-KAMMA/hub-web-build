import { getCloudflareContext } from "@opennextjs/cloudflare";

export function readYouTubeApiKey(env: unknown): string | undefined {
  const value = env && typeof env === "object" ? Reflect.get(env, "YOUTUBE_DATA_API_KEY") : undefined;
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function cloudflareApiKey(): string | undefined {
  try {
    return readYouTubeApiKey(getCloudflareContext().env);
  } catch {
    return undefined;
  }
}

export function getYouTubeDataApiKey(): string | undefined {
  return cloudflareApiKey() ?? (process.env.YOUTUBE_DATA_API_KEY?.trim() || undefined);
}
