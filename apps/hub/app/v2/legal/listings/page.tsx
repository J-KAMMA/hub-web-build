import type { Metadata } from "next";
import Link from "next/link";

import { ServiceLegalPage } from "@/components/service-legal-page";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../legal.css";
import "../../v2.css";

export const metadata: Metadata = { title: "公開Listingsの条件 | Hub v2" };

const LEGAL_DOCS = [
  { href: "/v2/legal", ja: "サービス条件" },
  { href: "/v2/legal/ai", ja: "AI利用条件" },
  { href: "/v2/legal/commerce", ja: "マーケット・Commerceの条件" },
  { href: "/v2/legal/music", ja: "Music利用条件" },
];

export default async function V2ListingsLegalPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "ほかの条件" : "Other terms"}</p>
      <ul className="v2-nav__list">
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.href}><Link className="v2-nav__item" href={doc.href}><span className="v2-nav__label">{doc.ja}</span></Link></li>
        ))}
      </ul>
    </>
  );

  return (
    <V2Shell
      currentPath="/v2/legal/listings"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "サービス条件" : "Service terms"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title="公開Listingsの条件" />
      <div className="v2-readdoc v2-readdoc--titled">
      <ServiceLegalPage title="公開Listingsの条件" summary="求人、不動産、乗り物、旅行などの規制分野では、Hubは公開情報の掲載・比較・外部リンクだけを提供します。" sections={[
          { title: "Hubが行わないこと", items: ["Hub内で応募、予約、内見申込み、条件交渉、契約締結、手付金・家賃・旅行代金・車両代金の受領を行いません。", "候補者の選定、雇用条件の調整、不動産・旅行の媒介または手配、車両の査定・保証・名義変更を行いません。", "成約額や採用結果に連動する手数料を受け取りません。"] },
          { title: "外部サイト", paragraphs: ["応募、問い合わせ、予約、購入は掲載事業者の公式外部サイトで直接行います。遷移先では外部事業者の本人確認、契約、料金、キャンセル、返金、プライバシー条件が適用されます。URL、事業者名、掲載日を確認してください。"] },
          { title: "掲載情報", paragraphs: ["掲載内容は事業者または公開情報源から提供され、更新遅延や誤りが含まれる場合があります。価格、在庫、募集状況、資格、免許、物件状態、運行・宿泊条件は契約前に提供元へ確認してください。Hubは虚偽、権利侵害、安全上の問題が疑われる掲載を停止できます。"] },
          { title: "料金", paragraphs: ["利用者の閲覧と外部遷移に成約手数料を課しません。掲載事業者向けの固定掲載料、SaaS料金、または明示された広告料金を設定する場合がありますが、取引成立の対価として徴収しません。"] },
        ]} />
      </div>
    </V2Shell>
  );
}
