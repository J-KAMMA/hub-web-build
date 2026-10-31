"use client";

import { useEffect, useState } from "react";
import { HUB_INTEREST_PROFILE_CHANGED_EVENT, readHubInterestProfile, topHubInterests } from "@/lib/hub-interest-profile";

export function HubpediaRecommendationTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  const [resolvedHref, setResolvedHref] = useState(href);
  useEffect(() => {
    const update = () => {
      const interest = topHubInterests(readHubInterestProfile(), 1)[0];
      if (!interest) { setResolvedHref(href); return; }
      const url = new URL(href, window.location.origin);
      if (!url.searchParams.has("q")) url.searchParams.set("q", interest);
      setResolvedHref(`${url.pathname}${url.search}`);
    };
    update();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, update);
    return () => window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, update);
  }, [href]);
  return <a href={resolvedHref} aria-current={active ? "page" : undefined}>{label}</a>;
}
