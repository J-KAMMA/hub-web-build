import React from "react";

/*
 * YouTube 以外の外部埋め込み（Vimeo・Twitch・TikTok・ニコニコ・Dailymotion・PeerTube・
 * Spotify・SoundCloud など）の置き場所（2026-10-14、所有者承認）。
 *
 * クリックされるまで、提供元へは何も取りに行かない（iframe も、提供元の script も作らない）。
 * 読み込むと提供元へ IP アドレスや端末・ブラウザの情報が届くので、その旨をここで言う。
 * 同意は保存しない。埋め込みごとに、読み込むたびに押してもらう。
 * YouTube は別の流れ（components/youtube-embed-consent.tsx。同意を端末に保存する）。
 */
export function ThirdPartyEmbedPlaceholder({
  providerLabel,
  sourceUrl,
  onLoad,
  className,
}: {
  providerLabel: string;
  sourceUrl: string;
  onLoad: () => void;
  className?: string;
}) {
  return (
    <div className={`youtube-embed-consent third-party-embed-placeholder${className ? ` ${className}` : ""}`} data-third-party-embed={providerLabel}>
      <p><strong>{providerLabel}の埋め込み</strong></p>
      <p>読み込むと、IPアドレスや端末・ブラウザの情報が{providerLabel}へ送信され、{providerLabel}がCookieなどを使う場合があります。押すまで、{providerLabel}へは何も送りません。</p>
      <p><a href="/terms">Hub利用規約</a>・<a href="/privacy">Hubプライバシーポリシー</a></p>
      <div>
        <button type="button" onClick={onLoad}>{providerLabel}を読み込む</button>
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc">{providerLabel}で開く</a>
      </div>
    </div>
  );
}
