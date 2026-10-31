import { NextResponse } from "next/server";

import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { readExportMedia } from "@/lib/server/portable-media";

/**
 * hub.account.bundle v2 に載せた画像を、移転先の Hub が取りに来る口。
 * 認証は要らない（取りに来るのは別の Hub）。代わりに token は推測できず、7日で失効し、
 * 元の画像が今も公開されているときだけ返す。R2 の鍵・署名付き URL は返さない。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  try {
    const { token } = await params;
    const media = await readExportMedia(getHubD1(), getHubMedia(), token);
    if (!media) return notFound();
    return new Response(media.body, {
      headers: {
        "content-type": media.mime,
        "content-length": String(media.body.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return notFound();
  }
}
