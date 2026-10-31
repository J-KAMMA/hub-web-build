import Link from "next/link";

import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";

/*
 * 自動車と不動産の役割を外した（2026-09-04）。旦那様の決定で画面ごと畳んである。
 * ここだけが「自動車出品者」「貸主・仲介者」を案内していて、押す先が無かった。
 */
const roles = [
  ["購入者", "商品購入、デジタル利用、返品"],
  ["販売者", "商品出品、在庫、発送、売上"],
  ["応募者", "仕事への応募と契約"],
  ["発注者・採用者", "募集、選考、支払い"],
] as const;

/*
 * 見ている面の中に留まる（2026-09-04）。サーバーの部品なのでフックは使えない。
 * 描く側が面を渡す。渡さなければ既存の面。
 */
export function HubTransactionCenter({ surface = "" }: { surface?: HubUiSurface } = {}) {
  return <section className="hub-account hub-transaction">
    <header className="hub-account__header">
      <div><small>Hubアカウント</small><h1>取引</h1><p>商品と仕事を一つの画面で管理します。</p></div>
      <Link href={hubSurfacePath(surface, "/account")}>アカウントへ戻る</Link>
    </header>

    <section className="hub-account__section">
      <h2>利用中の役割</h2>
      <p className="hub-account__lead">役割ごとに別アカウントを作る必要はありません。同じHubアカウントで必要な機能を利用できます。</p>
      <div className="hub-transaction__roles">{roles.map(([name, description]) => <article key={name}><strong>{name}</strong><span>{description}</span></article>)}</div>
    </section>

    <section className="hub-account__section">
      <h2>取引管理</h2>
      <div className="hub-account__links">
        <Link href={hubSurfacePath(surface, "/market/orders")}><strong>注文・返品</strong><span>購入履歴、配送、返品申請</span></Link>
        <Link href={hubSurfacePath(surface, "/market/sell")}><strong>商品を販売</strong><span>商品、在庫、送料、販売条件</span></Link>
        <Link href={hubSurfacePath(surface, "/work")}><strong>仕事</strong><span>応募、募集、契約</span></Link>
      </div>
    </section>

    <section className="hub-account__section">
      <h2>非公開情報</h2>
      <div className="hub-transaction__privacy">
        <article><strong>支払いと売上</strong><p>支払い、返金、売上、請求はCommerceが管理します。Hubへ決済情報を保存しません。</p><a href={hubSurfacePath(surface, "/account/payment")}>管理する</a></article>
        <article><strong>本人・事業者確認</strong><p>本名、住所、電話番号、確認書類はIdentityが管理します。公開プロフィールへ表示しません。</p><a href={hubSurfacePath(surface, "/account/identity")}>確認状況を見る</a></article>
        <article><strong>必要時だけ開示</strong><p>配送、応募、契約、申込みの目的に必要な情報だけを、本人の操作で相手へ開示します。</p></article>
      </div>
    </section>
  </section>;
}
