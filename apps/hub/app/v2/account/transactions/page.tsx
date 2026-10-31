import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HubTransactionCenter } from "@/components/hub-transaction-center";
import { V2AccountShell } from "@/components/v2/v2-account-shell";
import { getHubLocale } from "@/lib/server/locale";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../../v2.css";
import "../../../account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "取引 | Hub v2",
};

/* 取引の中心は既存の部品（Commerce との境界を持つ）をそのまま置く。 */
export default async function V2AccountTransactionsPage() {
  const [viewer, locale] = await Promise.all([getHubViewer(), getHubLocale()]);
  if (!viewer) redirect("/v2/auth?next=/v2/account/transactions");
  const japanese = locale === "ja";
  return (
    <V2AccountShell panelOwnsHeading currentPath="/v2/account/transactions" title={japanese ? "取引" : "Transactions"}>
      <div className="v2-account__panels">
        <HubTransactionCenter surface="/v2" />
      </div>
    </V2AccountShell>
  );
}
