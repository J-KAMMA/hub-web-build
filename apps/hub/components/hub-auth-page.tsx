import { HubAuthPanel } from "@/components/hub-auth-panel";
import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";

/*
 * ログインの本文（2026-09-05、旦那様の「全部を v2 に」）。
 *
 * もとは app/auth/page.tsx に直書きだった。v2 にも同じ画面が要るので切り出す。
 * **入口を複製しない**——ログインは一番多く踏まれる画面で、2つあると
 * 片方だけ直したときに「入れない人」が出る。
 *
 * 戻り先（returnTo）は面をまたぐことがある。v2 から来て v1 の道へ戻すと、
 * せっかく通した入口の外へ出てしまうので、来た道をそのまま使う。
 */
export function HubAuthPage({ returnTo, reauthenticate, surface = "" }: {
  returnTo: string;
  reauthenticate: boolean;
  surface?: HubUiSurface;
}) {
  return (
    <div className={`hub-auth-page${surface === "/v2" ? " hub-auth-page--embedded" : ""}`}>
      {surface !== "/v2" ? <a className="hub-auth-brand" href="/" aria-label="Hub ホームへ">Hub</a> : null}
      <section className="hub-auth-card" aria-labelledby="hub-auth-title">
        <header className="hub-auth-heading">
          {surface === "/v2"
            ? <h1 id="hub-auth-title">Hubにログイン</h1>
            : <h2 id="hub-auth-title">Hubにログイン</h2>}
          <span>はじめての方は「新規登録」を選んでください。</span>
        </header>
        <HubAuthPanel returnTo={hubSurfacePath(surface, returnTo)} reauthenticate={reauthenticate} />
        <details className="hub-auth-note hub-auth-more">
          <summary>アカウント情報の扱い</summary>
          <p>Hubには共通Account IDを保存せず、Hub専用の匿名識別子だけを連携します。</p>
        </details>
      </section>
    </div>
  );
}
