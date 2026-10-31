import { LegalToc } from "@/components/legal-toc";
import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";

/*
 * 利用規約の本文（2026-09-04）。
 *
 * もとは app/terms/page.tsx に直書きだった。v2 にも同じ画面が要るので
 * 切り出す。**規約の文を2か所に置かない**——片方だけ直すと、Hub が2つの
 * 規約を掲げることになる。
 */
export function HubTerms({ surface = "" }: { surface?: HubUiSurface }) {
  return (
    <div className="hub-legal">
          {surface === "/v2" ? <LegalToc /> : <header><p>HUB TERMS</p></header>}
          <section>
            <h2>Hubについて</h2>
            <p>Hubは、仮名プロフィールで投稿、スレッド、コミュニティ、公開カタログを利用できるサービスです。他者の権利を侵害する投稿、違法行為、なりすまし、嫌がらせ、スパム、不正アクセスは禁止します。</p>
          </section>
          <section>
            <h2>利用資格</h2>
            <p>Hubは16歳以上の方が利用できます。登録時に16歳以上であることを確認します（生年月日は集めません）。16歳未満と分かったときは、アカウントを削除することがあります。登録時には、同意した利用規約とプライバシーポリシーの版と日時を記録します。</p>
          </section>
          <section>
            <h2>投稿と削除</h2>
            <p>投稿者は公開する内容に必要な権利を持つものとします。権利侵害、安全上の問題、規約違反が疑われる場合、Hubは表示制限または削除を行うことがあります。通報機能から確認を依頼できます。</p>
          </section>
          <section>
            <h2>YouTube</h2>
            <p>Hubは動画の登録時確認にYouTube API Servicesを使用し、利用者が同意した場合にYouTubeの公式埋め込みプレイヤーを読み込みます。YouTube機能を利用することで、利用者は<a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube利用規約</a>にも拘束されることに同意するものとします。HubはYouTube動画を保存またはダウンロードしません。</p>
          </section>
          <section>
            <h2>接続サービスと取引</h2>
            <p>AI、Commerce、Vault、MusicなどはHub画面から利用できますが、データ、認証、決済、権利確認の責任はサービスごとに分離されています。商品・サービスの取引相手、総額、手数料、返金、外部提供元は実行前の表示を確認してください。詳しくは<a href={hubSurfacePath(surface, "/legal")}>サービス別の条件</a>を確認してください。</p>
          </section>
          <section>
            <h2>外部サービス</h2>
            <p>YouTube、Vimeo、ニコニコ動画、TikTok、Twitch、Spotify、Amazonなどの外部サービスには各社の規約が適用されます。リンクカードは外部コンテンツの複製ではなく参照情報です。公式プレイヤーの再生可否、地域・年齢制限、削除、購入、契約および返金は外部サービスが管理します。</p>
          </section>
          <section>
            <h2>免責と変更</h2>
            <p>Hubは情報の完全性、継続提供、外部サービスの動作を保証しません。安全・法令・外部サービス規約への対応に必要な場合、本規約や機能を変更することがあります。</p>
          </section>
          <section>
            <h2>問い合わせ</h2>
            <p><a href="https://jkamma.com/#contact">jkamma.comの問い合わせ窓口</a>から連絡してください。</p>
          </section>
        </div>
  );
}
