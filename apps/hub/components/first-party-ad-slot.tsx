"use client";

import React from "react";
import { useEffect, useRef, useState } from "react";
import type { HubAdContext } from "@/lib/hub-ads";
import { HUB_AD_PERSONALIZATION_CHANGED_EVENT, readHubAdInterestKeywords } from "@/lib/hub-ad-personalization";
import { HUB_INTEREST_PROFILE_CHANGED_EVENT } from "@/lib/hub-interest-profile";

export interface ServedAd {
  label: string;
  advertiserDisplayName: string;
  headline: string;
  description: string;
  imagePath?: string;
  altText: string;
  callToAction: string;
  clickUrl: string;
  aboutUrl: string;
}

function createClientRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function FirstPartyAdSlot({ placementKey, context, variant, developmentFallback }: {
  placementKey: string;
  context: HubAdContext;
  variant?: "image-grid"|"feed"|"thread"|"video"|"article";
  developmentFallback?: ServedAd;
}) {
  const [result, setResult] = useState<{ ad: ServedAd; measurementToken: string } | null>(null);
  const [interestKeywords, setInterestKeywords] = useState<string[] | null>(null);
  const [hidden,setHidden]=useState(false),[menuOpen,setMenuOpen]=useState(false),[feedbackBusy,setFeedbackBusy]=useState(false);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const sync = () => setInterestKeywords(readHubAdInterestKeywords());
    sync();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
    window.addEventListener(HUB_AD_PERSONALIZATION_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
      window.removeEventListener(HUB_AD_PERSONALIZATION_CHANGED_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    if (interestKeywords === null) return;
    const startedAt=performance.now();
    const controller = new AbortController();
    const personalizedContext = { ...context, contentKeywords: [...new Set([...(context.contentKeywords ?? []), ...interestKeywords])].slice(0, 50) };
    void fetch("/api/ads/serve", {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: createClientRequestId(), placementKey, context: personalizedContext }),
    }).then(async (response) => response.status === 204 ? null : response.ok ? response.json() as Promise<{ ad: ServedAd; measurementToken: string }> : null)
      .then((value) => { if (value) {setResult(value);if(performance.now()-startedAt>1500)void fetch("/api/ads/experience",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:value.measurementToken,action:"slow_render"}),keepalive:true});} })
      .catch(() => undefined);
    return () => controller.abort();
  }, [placementKey, context, interestKeywords]);

  useEffect(() => {
    if (!result || !root.current) return;
    const token = result.measurementToken;
    const send = (path: string, detail: Record<string, unknown> = {}) => void fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...detail }),
      keepalive: true,
    });
    send("/api/ads/rendered");
    if(typeof IntersectionObserver==="undefined")return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.intersectionRatio >= 0.5 && !sent) timer = setTimeout(() => {
        sent = true;
        send("/api/ads/viewable", { visibleRatio: entry.intersectionRatio, durationMs: 1_000 });
        observer.disconnect();
      }, 1_000);
      else if (timer) { clearTimeout(timer); timer = undefined; }
    }, { threshold: [0, 0.5, 1] });
    observer.observe(root.current);
    return () => { if (timer) clearTimeout(timer); observer.disconnect(); };
  }, [result]);

  const ad = result?.ad ?? (process.env.NODE_ENV === "production" ? null : developmentFallback ?? null);
  if (!ad||hidden) return null;
  const feedback=async(action:"hide_ad"|"hide_advertiser"|"not_interested"|"repetitive")=>{
    setFeedbackBusy(true);setHidden(true);
    if(result)await fetch("/api/ads/feedback",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:result.measurementToken,action}),keepalive:true}).catch(()=>undefined);
    setFeedbackBusy(false);
  };
  return <aside ref={root} className={`advertising${variant ? ` advertising--${variant}` : ""}`} aria-label="広告" data-ad-placement={placementKey}>
    <span className="advertising__label">{ad.label}</span><button type="button" className="advertising__menu-button" aria-label="広告メニュー" aria-expanded={menuOpen} onClick={()=>setMenuOpen((value)=>!value)}>•••</button>
    {menuOpen?<div className="advertising__menu"><button disabled={feedbackBusy} onClick={()=>void feedback("hide_ad")}>この広告を非表示</button><button disabled={feedbackBusy} onClick={()=>void feedback("hide_advertiser")}>この広告主を非表示</button><button disabled={feedbackBusy} onClick={()=>void feedback("not_interested")}>興味がない</button><button disabled={feedbackBusy} onClick={()=>void feedback("repetitive")}>繰り返し表示される</button><a href={ad.aboutUrl}>この広告が表示された理由</a><a href={ad.aboutUrl}>不適切な広告を通報</a></div>:null}
    <a className="advertising__card" href={ad.clickUrl} rel="sponsored nofollow noopener noreferrer">
      {ad.imagePath ? <img src={ad.imagePath} alt={ad.altText} loading="lazy" /> : null}
      <strong>{ad.headline}</strong><span>{ad.description}</span><small>{ad.callToAction} →</small>
    </a>
    <small className="advertising__disclosure">広告主: {ad.advertiserDisplayName} · <a href={ad.aboutUrl}>この広告について</a></small>
  </aside>;
}
