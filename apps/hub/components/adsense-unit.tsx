"use client";

import Script from "next/script";
import React, { useEffect } from "react";

import { AdConsentPrompt, useAdConsent } from "@/components/ad-consent";
import type { AdSenseFormat } from "@/lib/advertising";

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

/*
 * AdSense の枠。**同意の前には何も読み込まない**（2026-10-14、所有者承認。設定が
 * legacy でも同じ）。スクリプトも <ins> も、端末に "granted" が残っているときだけ作る。
 * 選びは lib/ad-consent.ts。EEA・英国・スイスへ出す前に Google 認定の CMP が要る。
 */
export function AdSenseUnit({
  clientId,
  slotId,
  format,
  fullWidthResponsive,
}: {
  clientId: string;
  slotId: string;
  format: AdSenseFormat;
  fullWidthResponsive: boolean;
}) {
  const consent = useAdConsent();
  const granted = consent.state === "granted";

  useEffect(() => {
    if (!granted) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ad blockers and consent tools may prevent initialization. The page remains usable.
    }
  }, [granted]);

  if (consent.state === null) return null;
  if (consent.state === "unset") {
    return <div className="advertising__adsense"><AdConsentPrompt onGrant={consent.grant} onDeny={consent.deny} /></div>;
  }
  if (consent.state === "denied") {
    return (
      <div className="advertising__adsense advertising__adsense--declined">
        <small>広告の表示は許可されていません。<button type="button" className="ad-consent__link" onClick={consent.reset}>選び直す</button></small>
      </div>
    );
  }

  return (
    <div className="advertising__adsense">
      <Script
        id={`adsense-script-${clientId}`}
        async
        crossOrigin="anonymous"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`}
        strategy="afterInteractive"
      />
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format={format}
        data-full-width-responsive={fullWidthResponsive ? "true" : "false"}
      />
    </div>
  );
}
