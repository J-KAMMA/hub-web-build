import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SetupAdminForm } from "@/components/setup-admin-form";
import { isBootstrapAvailable } from "@/lib/server/hub-bootstrap";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "最初の運営者の登録",
  robots: { index: false, follow: false },
};

/* 秘密が未設定、運営者が既にいる、使用済みのいずれかなら、この画面は存在しない。トークンはURLの # 以降にあり、サーバーには届かない。 */
export default async function SetupAdminPage() {
  const database = getOptionalHubD1();
  if (!database || !(await isBootstrapAvailable(database))) notFound();
  return <SetupAdminForm />;
}
