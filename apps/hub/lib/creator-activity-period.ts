export type CreatorActivityPeriod = "30d" | "90d" | "all";

export function creatorActivityCutoff(
  period: CreatorActivityPeriod,
  now = new Date(),
): string | null {
  if (period === "all") return null;
  const days = period === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
