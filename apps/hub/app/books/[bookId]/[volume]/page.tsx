import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyBooksBookIdVolumePage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string; volume: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { bookId, volume } = await params;
  return toV2(`/v2/books/${encodeURIComponent(bookId)}/${encodeURIComponent(volume)}`, await searchParams);
}
