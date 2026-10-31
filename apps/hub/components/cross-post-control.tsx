"use client";

import { useEffect, useState } from "react";
import { disconnectSocialProvider, getSocialConnections, renderSocialPreview, SOCIAL_TEXT_PROVIDERS, startSocialOAuth, type SocialTextProvider } from "@/lib/social-publisher-client";

const PROVIDER_LABEL: Record<SocialTextProvider, string> = { x: "X", threads: "Threads" };

export function CrossPostControl({ body, selected, confirmed, disabled, locale, onSelectedChange, onConfirmedChange }: {
  body: string;
  selected: SocialTextProvider[];
  confirmed: boolean;
  disabled: boolean;
  locale: string;
  onSelectedChange(value: SocialTextProvider[]): void;
  onConfirmedChange(value: boolean): void;
}) {
  const [connections, setConnections] = useState<Partial<Record<SocialTextProvider, string | null>>>({});
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getSocialConnections().then((items) => {
      if (!active) return;
      const next: Partial<Record<SocialTextProvider, string | null>> = {};
      for (const item of items) if (item.provider === "x" || item.provider === "threads") next[item.provider] = item.displayName ?? null;
      setConnections(next);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "接続状態を確認できませんでした。"); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const allSelectedConnected = selected.every((provider) => Object.hasOwn(connections, provider));
  const previewsReady = selected.length > 0 && selected.every((provider) => Boolean(renderSocialPreview(provider, body)));

  return <fieldset className="cross-post-control" disabled={disabled}>
    <legend>{locale === "en" ? "Also publish" : "同時投稿"}</legend>
    <p className="cross-post-control__note">{locale === "en" ? "Nothing is selected by default. Each service uses the account you connected yourself." : "初期状態ではどこにも送信しません。自分で接続したアカウントだけを選べます。"}</p>
    <p className="cross-post-control__note">{locale === "en" ? "YouTube is video-only and is configured from the video publishing screen." : "YouTubeは動画投稿専用です。動画の投稿画面から設定します。"}</p>
    <div className="cross-post-control__providers">
      {SOCIAL_TEXT_PROVIDERS.map((provider) => {
        const label = PROVIDER_LABEL[provider];
        const connected = Object.hasOwn(connections, provider);
        const checked = selected.includes(provider);
        return <div className="cross-post-control__provider" key={provider}>
          <label>
            <input type="checkbox" checked={checked} disabled={checking || !connected} onChange={(event) => {
              onSelectedChange(event.target.checked ? [...selected, provider] : selected.filter((item) => item !== provider));
              onConfirmedChange(false);
              setError("");
            }} />
            <span>{label}</span>
            <small>{checking ? (locale === "en" ? "Checking…" : "確認中…") : connected ? (connections[provider] ? `@${connections[provider]}` : (locale === "en" ? "Connected" : "接続済み")) : (locale === "en" ? "Not connected" : "未接続")}</small>
          </label>
          {!checking && !connected ? <button type="button" className="button" onClick={() => { setError(""); void startSocialOAuth(provider).catch((reason) => setError(reason instanceof Error ? reason.message : `${label}へ接続できませんでした。`)); }}>{locale === "en" ? `Connect ${label}` : `${label}を接続`}</button> : null}
          {!checking && connected ? <button type="button" className="button" onClick={() => {
            setError("");
            void disconnectSocialProvider(provider).then(() => {
              setConnections((current) => { const next = { ...current }; delete next[provider]; return next; });
              onSelectedChange(selected.filter((item) => item !== provider));
              onConfirmedChange(false);
            }).catch((reason) => setError(reason instanceof Error ? reason.message : `${label}との接続を解除できませんでした。`));
          }}>{locale === "en" ? "Disconnect" : "解除"}</button> : null}
        </div>;
      })}
    </div>
    {selected.length > 0 ? <div className="cross-post-control__preview">
      <strong>{locale === "en" ? "Exact external previews" : "外部へ送る内容（確定プレビュー）"}</strong>
      {selected.map((provider) => {
        const preview = renderSocialPreview(provider, body);
        const truncated = Array.from(body.trim()).length > (provider === "x" ? 280 : 500);
        return <section className="cross-post-control__preview-item" key={provider} aria-label={`${PROVIDER_LABEL[provider]} preview`}>
          <b>{PROVIDER_LABEL[provider]}</b>
          <p>{preview || (locale === "en" ? "Enter text." : "本文を入力してください。")}</p>
          {truncated ? <small>{locale === "en" ? "Only the text shown above will be sent." : "上に表示した部分だけを送信します。"}</small> : null}
        </section>;
      })}
      <label>
        <input type="checkbox" checked={confirmed} disabled={!allSelectedConnected || !previewsReady} onChange={(event) => onConfirmedChange(event.target.checked)} />
        <span>{locale === "en" ? "I checked every destination and exact text" : "すべての送信先と本文を確認しました"}</span>
      </label>
    </div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </fieldset>;
}
