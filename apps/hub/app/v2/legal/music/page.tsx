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

export const metadata: Metadata = { title: "Music利用条件 | Hub v2" };

const LEGAL_DOCS = [
  { href: "/v2/legal", ja: "サービス条件" },
  { href: "/v2/legal/ai", ja: "AI利用条件" },
  { href: "/v2/legal/commerce", ja: "マーケット・Commerceの条件" },
  { href: "/v2/legal/listings", ja: "公開Listingsの条件" },
];

export default async function V2MusicLegalPage() {
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
      currentPath="/v2/legal/music"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "サービス条件" : "Service terms"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title="Music利用条件" />
      <div className="v2-readdoc v2-readdoc--titled">
      <ServiceLegalPage title="Music利用条件" summary="Musicはオリジナル音源のアップロード、検査、公開、再生を管理する独立サービスです。" sections={[
          { title: "公開できる音源", paragraphs: ["公開者は音源、演奏、歌詞、画像、説明、使用した素材について必要な権利を持ち、公開・配信できることを確認します。AIツールを使用した場合は、提供元、モデル、利用条件、商用利用可否、寄与内容を記録します。"] },
          { title: "アップロードと配信", paragraphs: ["音源は隔離領域へアップロードされ、検査完了後に公開者が別途公開します。検査中、拒否、停止、未公開の音源は配信しません。Musicは基礎ストレージのオブジェクト位置を利用者へ返しません。"] },
          { title: "外部音楽サービス", paragraphs: ["Spotifyなど外部サービスのコンテンツは、利用者が再生を選んだ後に公式プレイヤーから読み込みます。再生、地域制限、削除、広告、Cookie、利用情報は外部サービスの規約とポリシーに従います。"] },
          { title: "販売", paragraphs: ["Music自体には購入・決済機能を設けません。将来、音源または利用権を販売する場合はCommerceの商品として、価格、ライセンス、販売者、返金条件を別途表示します。"] },
        ]} />
      </div>
    </V2Shell>
  );
}
