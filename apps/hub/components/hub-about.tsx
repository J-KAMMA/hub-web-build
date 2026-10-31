/*
 * Hubについての本文（2026-09-04、旦那様の「全部を v2 に」）。
 *
 * もとは app/about/page.tsx に直書きだった。v2 にも同じ画面が要るので切り出す。
 * 表示名だけ外から受け取る——この部品は誰が見ているかを自分で調べない。
 */
import { getSourceCodeUrl } from "@/lib/instance-origin";

const principles = [
  ["公開する名前を選ぶ", "表示名には本名、活動名、仮名を使用できます。Hubは表示名の本人確認を行いません。"],
  ["本人確認情報を持たない", "メールアドレス、電話番号、住所、本人確認状態などの非公開な本人確認情報をHubプロフィールへ結び付けません。"],
  ["サービスを分離", "jkamma.com、デジタル、Identityとはログイン、Cookie、データベース、利用者識別子を共有しません。"],
  ["対話の形式を選ぶ", "短い投稿、長いスレッド、公開プロフィールを使い分けながら、異なる意見を残せる場を目指します。"],
  ["広告を明確に分ける", "広告、スポンサー掲載、投稿者の紹介リンクには広告表示を付け、投稿や運営上の評価と区別します。"]
] as const;

export function HubAbout({ displayName }: { displayName: string }) {
  const sourceUrl = getSourceCodeUrl();
  return (
    <div className="hub-about">
      <header><h2>選んだ名前で、<br />考えを積み重ねる。</h2><span>現在は {displayName} として公開表示しています。</span></header>
      <div className="hub-about__principles">{principles.map(([title, description], index) => <article key={title}><b>{String(index + 1).padStart(2, "0")}</b><h2>{title}</h2><p>{description}</p></article>)}</div>
      <section className="hub-about__separation"><div><small>PERSONAL SITE</small><h2>運営者自身の発信はjkamma.comへ。</h2><p>Hubの投稿や参加者の意見は、jkamma.comの運営者個人の見解とは分けて扱います。</p></div><a href="https://jkamma.com">jkamma.comを見る <span aria-hidden="true">↗</span></a></section>
      {sourceUrl ? <p className="hub-about__source"><a href={sourceUrl} rel="noopener noreferrer">ソースコード</a></p> : null}
    </div>
  );
}
