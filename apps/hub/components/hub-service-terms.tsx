import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";

import Link from "next/link";

/*
 * サービス条件の本文（2026-09-04）。
 *
 * もとは app/legal/page.tsx に直書きだった。v2 にも同じ画面が要るので
 * 切り出す。**規約の文を2か所に置かない**——片方だけ直すと、Hub が2つの
 * 規約を掲げることになる。
 */
const documents = [
  ["/legal/commerce", "マーケット・Commerce", "販売、決済、手数料、返金"],
  ["/legal/ai", "AI", "実行料金、上限額、失敗時の扱い"],
  ["/legal/music", "Music", "音源の権利、配信、外部プレイヤー"],
  ["/legal/listings", "公開Listings", "求人、不動産、乗り物、旅行の掲載境界"],
] as const;

export function HubServiceTerms({ surface = "" }: { surface?: HubUiSurface }) {
  return (
    <section className="hub-legal">
        <header>{surface === "/v2" ? null : <p>サービス条件</p>}<h1>サービス別の条件</h1><p>取引相手、保存先、支払い、返金、外部サービスの責任を機能ごとに確認できます。</p></header>
        <section>
          <h2>文書一覧</h2>
          <ul>{documents.map(([href, label, detail]) => <li key={href}><Link href={hubSurfacePath(surface, href)}>{label}</Link> — {detail}</li>)}</ul>
        </section>
        <section>
          <h2>共通文書</h2>
          <p><Link href={hubSurfacePath(surface, "/terms")}>Hub利用規約</Link>・<Link href={hubSurfacePath(surface, "/privacy")}>プライバシーポリシー</Link></p>
        </section>
      </section>
  );
}
