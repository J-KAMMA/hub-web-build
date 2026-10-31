"use client";

import React from "react";

import { HUB_REGION_COOKIE, HUB_REGIONS, type HubRegion } from "@/lib/hub-region";

const names: Record<HubRegion, string> = {
  jp: "日本",
  na: "北米",
  kr: "韓国",
  zh: "中国語圏",
};

export function RegionSelector({ region, label, description }: { region: HubRegion; label: string; description?: string }) {
  return <label className="setting-select region-selector">
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <select aria-label={label} value={region} onChange={(event) => {
      const next = event.target.value as HubRegion;
      document.cookie = `${HUB_REGION_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax`;
      window.location.reload();
    }}>
      {HUB_REGIONS.map((item) => <option key={item} value={item}>{names[item]}</option>)}
    </select>
  </label>;
}
