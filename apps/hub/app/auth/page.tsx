import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  if (next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/v2")) {
    return toV2("/v2/auth", { ...params, next: `/v2${next}` });
  }
  return toV2("/v2/auth", params);
}
