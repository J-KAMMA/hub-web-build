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

export const metadata: Metadata = { title: "AI利用条件 | Hub v2" };

const LEGAL_DOCS = [
  { href: "/v2/legal", ja: "サービス条件" },
  { href: "/v2/legal/commerce", ja: "マーケット・Commerceの条件" },
  { href: "/v2/legal/listings", ja: "公開Listingsの条件" },
  { href: "/v2/legal/music", ja: "Music利用条件" },
];

export default async function V2AiLegalPage() {
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
      currentPath="/v2/legal/ai"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "サービス条件" : "Service terms"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title="AI利用条件" />
      <div className="v2-readdoc v2-readdoc--titled">
      <ServiceLegalPage title="AI利用条件" summary="AI実行は一般商品の1%手数料ではなく、モデル・ツールの実原価に基づく従量料金です。" sections={[
          { title: "料金", items: ["署名前にモデル、処理内容、最大請求額、ネットワークを表示します。", "サーバーは表示額以下の上限を再検証し、上限を超える実行を拒否します。", "実行料金は上流原価、処理方式、外部ツール実費、明示された基盤料金から計算します。", "ローカル実行は無料または端末負担として、クラウド実行と区別します。"] },
          { title: "失敗・精算", paragraphs: ["検証、決済、プロバイダー、応答または精算を確認できない場合は安全側へ閉じます。実行前に確保した上限額のうち未使用分は請求せず、未実行または精算不能の支払い枠は所定の処理で解放・返金します。"] },
          { title: "出力の利用", paragraphs: ["AI出力は誤り、不完全な推論、古い情報を含む場合があります。医療、法律、金融、安全、権利処理など重要な判断では、一次資料と資格を持つ専門家による確認が必要です。利用者は入力と出力を利用する権限を確認します。"] },
          { title: "データ境界", paragraphs: ["プロンプト、結果、会話、記憶、プロジェクト、利用記録はAIサービスが管理し、Hubデータベースへ保存しません。同期は利用者が明示的に有効化した場合だけ行い、停止、解除、書き出し、削除を別々に操作できます。"] },
        ]} />
      </div>
    </V2Shell>
  );
}
