"use client";

import React, { useCallback, useEffect, useState } from "react";

const YOUTUBE_CONSENT_KEY = "hub.youtube_embed_consent";
const YOUTUBE_CONSENT_EVENT = "hub:youtube-embed-consent";

export function revokeYouTubeEmbedConsent() {
  try { window.localStorage.removeItem(YOUTUBE_CONSENT_KEY); } catch { /* storage may be unavailable */ }
  window.dispatchEvent(new Event(YOUTUBE_CONSENT_EVENT));
}

type PermissionState =
  | { status: "allowed"; embedUrl: string; message: string }
  | { status: "denied"; embedUrl: null; message: string };

export function useYouTubeEmbedPermission(videoId: string, enabled = true, _preapproved = false): PermissionState & { accept: () => void } {
  const [consented, setConsented] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const sync = () => {
      try { setConsented(window.localStorage.getItem(YOUTUBE_CONSENT_KEY) === "accepted"); }
      catch { setConsented(false); }
    };
    sync();
    window.addEventListener(YOUTUBE_CONSENT_EVENT, sync);
    return () => window.removeEventListener(YOUTUBE_CONSENT_EVENT, sync);
  }, [enabled]);
  const accept = useCallback(() => {
    try {
      window.localStorage.setItem(YOUTUBE_CONSENT_KEY, "accepted");
    } catch {
      // Playback remains available for this page when storage is blocked.
    }
    setConsented(true);
    window.dispatchEvent(new Event(YOUTUBE_CONSENT_EVENT));
  }, []);

  if (!enabled) {
    return { status: "denied", embedUrl: null, message: "", accept: () => {} };
  }
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
    return {
      status: "denied",
      embedUrl: null,
      message: "動画IDが正しくありません。",
      accept: () => {},
    };
  }
  if (consented) return {
      status: "allowed",
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
      message: "",
      accept,
    };
  return {
    status: "denied",
    embedUrl: null,
    message: "再生すると、IPアドレスや端末・ブラウザ情報などがYouTube（Google）へ送信される場合があります。利用規約とプライバシーポリシーを確認してから読み込んでください。",
    accept,
  };
}

export function YouTubeEmbedConsentPrompt({
  message,
  onAccept,
  sourceUrl,
}: {
  message: string;
  onAccept: () => void;
  sourceUrl: string;
  status: PermissionState["status"];
}) {
  return (
    <div className="youtube-embed-consent">
      <p>{message}</p>
      <p><a href="/terms">Hub利用規約</a>・<a href="/privacy">Hubプライバシーポリシー</a></p>
      <p><a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube利用規約</a>・<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Googleプライバシーポリシー</a></p>
      <div>
        <button type="button" onClick={onAccept}>同意して再生</button>
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc">YouTubeで開く</a>
      </div>
    </div>
  );
}
