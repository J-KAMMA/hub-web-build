import { cookies } from "next/headers";

import { AdvertisingInventoryLogin } from "@/components/advertising-inventory-filter";
import { AdvertisingMockPreview } from "@/components/advertising-mock-preview";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";

export default async function AdvertisingMockPage() {
  const cookieStore = await cookies();
  const authenticated = isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value);
  if (!authenticated) {
    return <section className="ad-inventory-page ad-inventory-page--locked"><span>ADVERTISING ADMIN</span><h1>広告モック</h1><p>管理者認証後にプレビューできます。</p><AdvertisingInventoryLogin /></section>;
  }
  return <section className="ad-inventory-page">
    <header><span>ADVERTISING MOCK</span><h1>広告モック</h1><p>実広告を読み込まず、Hub内での表示だけを確認します。</p><nav className="ad-admin-links"><a href="/admin/advertising">インベントリーへ戻る</a></nav></header>
    <AdvertisingMockPreview />
  </section>;
}
