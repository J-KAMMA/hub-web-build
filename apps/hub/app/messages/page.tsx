import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyMessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const channel = Array.isArray(params.channel) ? params.channel[0] : params.channel;
  return toV2(channel === "email" ? "/v2/messages/email" : "/v2/messages", params);
}
