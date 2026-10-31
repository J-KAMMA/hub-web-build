import type { V2NavItem } from "@/components/v2/v2-shell";
import { filterOptionalNav } from "./optional-services";

/*
 * v2 のナビの項目。画面ごとに同じ並びを書いていたので1か所に寄せる。
 *
 * 2026-10-11: Hub は AI・ブラウザ・SNS・ECを1つにしたアプリ。ナビは Windows の
 * タスクマネージャーと同じ1本の列で、群の見出しは持たない。交流という括りは廃止した。
 * スレッドとコミュニティはタイムラインのタブに移した（列には置かない）。
 * 検索は上部の検索欄と「/」キーから使うので列に置かない。プロジェクトと研究、
 * ほかの機能は「すべての機能」から入る。下の2つ（プロフィール・設定）は
 * `bottom` で下端に寄せる。
 *
 * 2026-10-15 所有者: ウォレットは左のナビから右列（右端の帯の「ウォレット」）へ移した。全画面は
 * 右列の「ウォレットを開く」・「すべての機能」・設定から /v2/wallet へ入る。Desktop の左レール（hub-desktop/ui/index.html）と同じ順序。
 *
 * 2026-10-30 所有者: 上の10/15の決定を取り消し、ウォレットを左のナビ（すべての機能の次）へ戻した。1クリックで入れる。
 *
 * 2026-10-29 所有者（10/15・10/18の「マーケット先頭」を置き換え）: 並びはタイムライン、通知、メッセージ、記事、動画、音楽、ゲーム、研究、マーケット、すべての機能（Desktop は下の群がマーケット、ブラウザ、AI）。群の間は線でなく余白（gapBefore）で分ける。
 *
 * ブラウザは v2 に画面が無いので既存の /browser へ向ける。
 * プロフィールの行き先は本人のハンドルが要るので、V2Shell が `profile` の行で差し替える。
 */
export function v2NavItems(japanese: boolean, counts: { notifications?: number; messages?: number } = {}): V2NavItem[] {
  const t = (ja: string, en: string) => (japanese ? ja : en);
  return filterOptionalNav([
    { href: "/v2", icon: "timeline", label: t("タイムライン", "Timeline") },
    { href: "/v2/notifications", icon: "bell", label: t("通知", "Notifications"), count: counts.notifications, live: "notifications" },
    { href: "/v2/messages", icon: "mail", label: t("メッセージ", "Messages"), count: counts.messages, live: "messages" },
    { href: "/v2/articles", icon: "article", label: t("記事", "Articles"), gapBefore: true },
    { href: "/v2/videos", icon: "video", label: t("動画", "Video") },
    { href: "/v2/music", icon: "music", label: t("音楽", "Music") },
    { href: "/v2/games", icon: "game", label: t("ゲーム", "Games") },
    { href: "/v2/research", icon: "research", label: t("研究", "Research") },
    { href: "/v2/market", icon: "store", label: t("マーケット", "Market"), gapBefore: true },
    { href: "/v2/services", icon: "apps", label: t("すべての機能", "All features") },
    { href: "/v2/wallet", icon: "wallet", label: t("ウォレット", "Wallet") },
    { href: "/v2/profile", icon: "user", label: t("プロフィール", "Profile"), bottom: true, profile: true },
    { href: "/v2/settings", icon: "settings", label: t("設定", "Settings"), bottom: true },
  ]);
}
