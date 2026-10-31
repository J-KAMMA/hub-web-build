import type { Metadata } from "next";
import Link from "next/link";

import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../v2.css";
import "../v2-tools.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "広告 | Hub v2", description: "Hub Adsの出稿、x402前払い、配信状況を管理する広告センター" };

const AREAS: { title: string; body: string; href: string; label: string; icon: V2IconName }[] = [
  { title: "広告を出す", body: "広告専用Accountで、自分のキャンペーン、素材、集計だけを管理します。", href: "/v2/advertising/dashboard", label: "広告管理を開く", icon: "ai" },
  { title: "予算を管理", body: "キャンペーンごとの予算、消化額、残高のお知らせを広告主画面で確認します。", href: "/v2/advertising/dashboard#campaigns", label: "予算を見る", icon: "wallet" },
  { title: "配信を確認", body: "表示数、クリック数、消化額と前期間からの変化を広告主画面で確認できます。", href: "/v2/advertising/dashboard#reports", label: "レポートを見る", icon: "trending" },
  { title: "公開中の広告", body: "Hubで実際に配信された広告を、個人別の閲覧履歴なしで公開しています。", href: "/v2/advertising/library", label: "広告ライブラリを見る", icon: "list" },
  { title: "広告ポリシー", body: "広告パーソナライズ、計測、外部リンク、安全検査の扱いを確認できます。", href: "/v2/privacy", label: "プライバシーを見る", icon: "lock" },
];

/* 広告センターの入口。既存の /advertising と同じ4区画に、公開ライブラリへの入口を足した。 */
export default function V2AdvertisingPage() {
  return (
    <V2PanelPage currentPath="/v2/advertising" title="広告" note="Hub Ads">
      <p className="v2-note">フィードや記事の流れを壊さず、「広告」と明示したスポンサー表示を配信します。個人を追跡する広告プロフィールは作りません。</p>
      <ul className="v2-ads-areas">
        {AREAS.map((area) => (
          <li key={area.href} className="v2-ads-areas__item">
            <Link className="v2-ads-area" href={area.href} aria-label={`${area.title}。${area.label}`}>
              <span className="v2-ads-area__icon"><V2Icon name={area.icon} /></span>
              <span className="v2-ads-area__body">
                <span className="v2-ads-area__title">{area.title}</span>
                <span className="v2-ads-area__note">{area.body}</span>
              </span>
              <V2Icon name="chevron-right" className="v2-ads-area__chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </V2PanelPage>
  );
}
