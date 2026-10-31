import type { Metadata } from "next";

import { DesktopDeviceApproval } from "@/components/desktop-device-approval";
import { V2AccountShell } from "@/components/v2/v2-account-shell";
import { getHubLocale } from "@/lib/server/locale";

import "../../v2.css";
import "../../../account.css";
import "../../v2-account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Desktop端末を承認 | Hub v2",
};

/* 承認そのものは既存の部品（鍵の受け渡しを持つ）をそのまま置く。 */
export default async function V2DesktopDeviceApprovalPage({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  const [locale, params] = await Promise.all([getHubLocale(), searchParams]);
  const japanese = locale === "ja";
  const raw = params.request;
  const requestId = typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw) ? raw : "";
  return (
    <V2AccountShell currentPath="/v2/account/desktop" title={japanese ? "Desktop端末を承認" : "Approve a desktop device"}>
      <div className="hub-account v2-account__panels">
        <DesktopDeviceApproval key={requestId} requestId={requestId} />
      </div>
    </V2AccountShell>
  );
}
