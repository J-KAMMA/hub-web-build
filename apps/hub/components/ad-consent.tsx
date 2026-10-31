"use client";

import React, { useCallback, useEffect, useState } from "react";

import { AD_CONSENT_EVENT, readAdConsent, writeAdConsent, type AdConsentState } from "@/lib/ad-consent";

/* null は「まだ端末の選びを読んでいない」（サーバー描画と最初の描画）。 */
export function useAdConsent(): { state: AdConsentState | null; grant: () => void; deny: () => void; reset: () => void } {
  const [state, setState] = useState<AdConsentState | null>(null);
  useEffect(() => {
    const sync = () => setState(readAdConsent());
    sync();
    window.addEventListener(AD_CONSENT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AD_CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const grant = useCallback(() => { writeAdConsent("granted"); setState("granted"); }, []);
  const deny = useCallback(() => { writeAdConsent("denied"); setState("denied"); }, []);
  const reset = useCallback(() => { writeAdConsent("unset"); setState("unset"); }, []);
  return { state, grant, deny, reset };
}

/* 広告枠の中に出す同意の欄。選ぶまで、Google へは何も送らない。 */
export function AdConsentPrompt({ onGrant, onDeny }: { onGrant: () => void; onDeny: () => void }) {
  return (
    <div className="ad-consent" role="group" aria-label="広告の同意">
      <p><strong>広告の表示について</strong></p>
      <p>広告を表示すると、Google（AdSense）がCookieなどを使い、IPアドレスや端末・ブラウザの情報を受け取ります。許可するまで、Googleへは何も送りません。いつでも設定から取り消せます。</p>
      <p><a href="/privacy">Hubプライバシーポリシー</a>・<a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">Googleの広告のしくみ</a></p>
      <div className="ad-consent__actions">
        <button type="button" onClick={onGrant}>広告を表示する</button>
        <button type="button" className="ad-consent__deny" onClick={onDeny}>表示しない</button>
      </div>
    </div>
  );
}
