import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UiSpecimen } from "@/components/v2/ui/specimen";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../v2.css";

export const metadata: Metadata = { title: "共通部品 | Hub v2", robots: { index: false, follow: false } };

/* v2 の共通部品の見本。開発用で、本番には出さない。ライト・ダークで撮って見た目を確かめる。 */
export default function V2UiSpecimenPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <V2PanelPage currentPath="/v2/developers/ui" title="共通部品">
      <UiSpecimen />
    </V2PanelPage>
  );
}
