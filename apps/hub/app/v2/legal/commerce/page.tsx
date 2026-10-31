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

export const metadata: Metadata = { title: "マーケット・Commerceの条件 | Hub v2" };

const LEGAL_DOCS = [
  { href: "/v2/legal", ja: "サービス条件" },
  { href: "/v2/legal/ai", ja: "AI利用条件" },
  { href: "/v2/legal/listings", ja: "公開Listingsの条件" },
  { href: "/v2/legal/music", ja: "Music利用条件" },
];

export default async function V2CommerceLegalPage() {
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
      currentPath="/v2/legal/commerce"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "サービス条件" : "Service terms"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title="マーケット・Commerceの条件" />
      <div className="v2-readdoc v2-readdoc--titled">
      <ServiceLegalPage title="マーケット・Commerceの条件" summary="一般商取引の販売手数料は本体価格の1%（消費税込み）で、販売者が負担します。購入代金と秘密鍵をHubへ預けない直接決済を原則とします。" sections={[
          { title: "取引相手", paragraphs: ["商品の販売者またはサービス提供者が購入者との取引当事者です。販売者名、総額、配送、提供条件、法定表示へのリンクを確認してから支払います。Hubの表示と販売者の個別条件が矛盾する場合、支払いを中止してください。"] },
          { title: "料金と支払い", items: ["販売手数料は本体価格の1%（消費税込み）で、販売者が負担します。","オンチェーンの分配額は、税抜の商品・サービス本体額の1%です。", "対応決済では販売者99%・Hub 1%を同じ取引で分配し、Hubが購入代金を預かって後日送金しません。", "購入者への未表示の上乗せ手数料は課しません。配送、税、保管などの実費は決済前の総額へ分けて表示します。", "ネットワーク、受取先、最大ガス、最大請求額を確認し、利用者のウォレットで署名します。"] },
          { title: "返金・取消し", paragraphs: ["返品可否、受付期限、返送費用、デジタル商品の提供後の扱いは、購入前に表示される販売者の条件に従います。Commerceは注文、領収証、取消し、返金状態を記録し、同じ支払い・返金の二重利用を拒否します。Hubまたは確認サービスが利用できない場合、決済を成功扱いにしません。"] },
          { title: "エスクロー", paragraphs: ["実物通販または業務成果物でエスクローが明示された場合だけ、表示されたコントラクト条件が適用されます。入金、発送または納品、検収、期限、返金、紛争の状態を署名前に確認してください。運営者が秘密鍵で利用者資産を任意に移動する内部残高は設けません。"] },
        ]} />
      </div>
    </V2Shell>
  );
}
