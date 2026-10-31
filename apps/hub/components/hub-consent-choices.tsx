"use client";

import React from "react";

import { useAdConsent } from "@/components/ad-consent";
import { revokeYouTubeEmbedConsent } from "@/components/youtube-embed-consent";

/*
 * 広告と外部埋め込みの同意を、設定から見直す入口（2026-10-14）。
 * 同意は端末ごと。YouTube は同意を保存する。YouTube 以外の埋め込みは同意を保存せず、
 * 読み込むたびに押してもらう。
 */
export function HubConsentChoices() {
  const ads = useAdConsent();
  const label = ads.state === "granted" ? "表示を許可している" : ads.state === "denied" ? "表示しない" : "まだ選んでいない（広告は読み込まない）";
  return (
    <div className="hub-consent-choices">
      <p>広告: <strong>{ads.state === null ? "…" : label}</strong></p>
      <p>
        {ads.state === "granted" ? <button type="button" onClick={ads.deny}>広告の許可を取り消す</button> : null}
        {ads.state === "denied" ? <button type="button" onClick={ads.reset}>選び直す</button> : null}
      </p>
      <p><button type="button" onClick={revokeYouTubeEmbedConsent}>YouTube埋め込みの許可を取り消す</button></p>
      <small>この選びはこの端末だけに保存されます。YouTube以外の埋め込みは、読み込むたびに確認します。</small>
    </div>
  );
}
