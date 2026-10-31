import { cookies } from "next/headers";

import { AdvertisingInventoryFilter, AdvertisingInventoryLogin } from "@/components/advertising-inventory-filter";
import { buildAdvertisingInventory } from "@/lib/advertising-inventory";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";

export default async function AdvertisingAdminPage() {
  const cookieStore = await cookies();
  const authenticated = isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value);
  if (!authenticated) {
    return <section className="ad-inventory-page ad-inventory-page--locked">
      <span>ADVERTISING ADMIN</span>
      <h1>広告インベントリー</h1>
      <p>単価や配信期間を含むため、管理者認証後に表示します。</p>
      <AdvertisingInventoryLogin />
    </section>;
  }
  const inventory = buildAdvertisingInventory(process.env);
  return <section className="ad-inventory-page">
    <header><span>ADVERTISING ADMIN</span><h1>広告インベントリー</h1><p>掲載可能な広告枠とスポンサー案件を条件で絞り込みます。</p><nav className="ad-admin-links"><a href="/admin/advertising/manage">広告運用管理</a> · <a href="/admin/advertising/mock">広告モックを開く</a></nav></header>
    <AdvertisingInventoryFilter inventory={inventory} />
  </section>;
}
