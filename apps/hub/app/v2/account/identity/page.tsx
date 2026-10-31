import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { V2AccountShell } from "@/components/v2/v2-account-shell";
import { getHubLocale } from "@/lib/server/locale";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "本人・事業者確認 | Hub v2",
};

/* 既存の /account/identity と同じ文言。確認そのものは Identity 側で行う。 */
export default async function V2AccountIdentityPage() {
  const [viewer, locale] = await Promise.all([getHubViewer(), getHubLocale()]);
  if (!viewer) redirect("/v2/auth?next=/v2/account/identity");
  const japanese = locale === "ja";
  return (
    <V2AccountShell currentPath="/v2/account/identity" title={japanese ? "本人・事業者確認" : "Identity verification"} note={japanese ? "必要な取引に限って使う" : "Used only where a transaction requires it"}>
      <section className="v2-msec" aria-labelledby="v2-identity-separation">
        <header className="v2-msec__head"><h2 id="v2-identity-separation" className="v2-column__title v2-column__title--section">{japanese ? "公開プロフィールとは分けて扱う" : "Kept apart from the public profile"}</h2></header>
        <p className="v2-note">{japanese ? "本名、住所、電話番号、確認書類は Identity が管理します。Hub の表示名、投稿、レビュー、公開プロフィールには出ません。" : "Legal name, address, phone and documents are managed by Identity. They never appear on the display name, posts, reviews or public profile."}</p>
      </section>
      <section className="v2-msec" aria-labelledby="v2-identity-principles">
        <header className="v2-msec__head"><h2 id="v2-identity-principles" className="v2-column__title v2-column__title--section">{japanese ? "開示の原則" : "Disclosure rules"}</h2></header>
        <ul className="v2-account__areas">
          <li><span><strong>{japanese ? "配送" : "Shipping"}</strong><span>{japanese ? "購入者の操作後、配送に必要な宛名と住所だけを使う。" : "After the buyer acts, only the name and address needed for delivery are used."}</span></span></li>
          <li><span><strong>{japanese ? "応募・契約" : "Applications and contracts"}</strong><span>{japanese ? "本人が選んだ連絡先、職歴、契約情報だけを相手へ開示する。" : "Only the contact, history and contract details you choose are shared."}</span></span></li>
          <li><span><strong>{japanese ? "販売・掲載" : "Selling and listing"}</strong><span>{japanese ? "公開名は活動名や店舗名を使い、法令上必要な情報は所定の表示に限る。" : "Public names are trade or shop names; legally required details appear only where prescribed."}</span></span></li>
        </ul>
      </section>
    </V2AccountShell>
  );
}
