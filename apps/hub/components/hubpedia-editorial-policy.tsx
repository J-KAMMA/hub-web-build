import { LegalToc } from "@/components/legal-toc";
import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";

/*
 * Hubpedia の編集方針（2026-09-04）。
 *
 * もとは app/hubpedia/about/page.tsx に直に書いてあった。v2 にも同じ画面が
 * 要るので、**複製せず部品に切り出す**。方針の文は2か所に置かない——
 * 片方だけ直した瞬間に、Hub が2つの方針を掲げることになる。
 *
 * 中の行き先（Hubについて・プライバシー・利用規約・問い合わせ）は面を持たない
 * 文書なので包まない。どちらの面から来ても同じ1枚を出す。
 */
export function HubpediaEditorialPolicy({ surface = "" }: { surface?: HubUiSurface }) {
  return (
    <div className="hub-legal">
      {surface === "/v2" ? <LegalToc /> : <header><p>Hubpedia</p><h2>Hubpediaの編集方針</h2></header>}
      <section>
        <h2>目的</h2>
        <p>Hubpediaは、人物、作品、科学、技術、社会、文化などの基礎情報を、相互に参照できる百科事典として提供します。検索順位や広告表示のためだけにページを作らず、各記事が単独でも対象を理解する助けになることを掲載条件とします。</p>
      </section>
      <section>
        <h2>記事制作とAI</h2>
        <p>記事の下書き、翻訳、リンク候補の抽出にはAIを使用する場合があります。AIの出力をそのまま掲載条件とはせず、最低限の長さ、主題に沿った構成、重複、内部リンク、危険分野の確認状態などを自動監査します。固有名詞の正式表記を維持し、定型文の反復や内容のない量産記事は公開対象から除外します。</p>
      </section>
      <section>
        <h2>正確性と出典</h2>
        <p>出典を表示する場合は、公開条件と商用利用上の扱いを確認した資料を使用します。出典がない記事は、そのことを隠さず確認状態を表示します。医療、法律、金融、政治、安全に関わる記事は、個別の助言を行わず、未確認の状態では公開しません。</p>
      </section>
      <section>
        <h2>訂正と更新</h2>
        <p>誤記、古い情報、権利上の問題を見つけた場合は、<a href="https://jkamma.com/#contact">問い合わせ窓口</a>から対象記事のURLと修正理由を連絡できます。内容を確認し、必要に応じて訂正、非公開化、リンク修正を行います。</p>
      </section>
      <section>
        <h2>広告との分離</h2>
        <p>広告、スポンサー、アフィリエイト収益は、記事の結論、掲載対象、確認状態を決める理由にはしません。広告は「広告」と表示し、本文、目次、関連記事、ナビゲーションと区別します。</p>
      </section>
      <section>
        <h2>運営情報</h2>
        <p>HubpediaはHub内で運営されています。サービス全体の説明は<a href={hubSurfacePath(surface, "/about")}>Hubについて</a>、情報の取扱いは<a href={hubSurfacePath(surface, "/privacy")}>プライバシーポリシー</a>、利用条件は<a href={hubSurfacePath(surface, "/terms")}>利用規約</a>を確認してください。</p>
      </section>
    </div>
  );
}
