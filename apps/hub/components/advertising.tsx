import React from "react";
import { AdSenseUnit } from "@/components/adsense-unit";
import { FirstPartyAdSlot } from "@/components/first-party-ad-slot";
import { StaticDemoAd } from "@/components/static-demo-ad";
import {
  isAdvertisingEnabled,
  normalizeAdSenseClientId,
  normalizeAdSenseFormat,
  normalizeAdSenseSlotId,
  normalizeFullWidthResponsive,
  normalizeSponsorUrl,
  type HubAdPlacement,
} from "@/lib/advertising";
import {
  normalizeSponsorRotationHours,
  parseSponsorCampaigns,
  selectSponsorCampaign,
  type SponsorCampaign,
} from "@/lib/sponsor-selection";

interface AdvertisingProps {
  placement: HubAdPlacement;
  contextText?: string;
  locale?: string;
  showSponsor?: boolean;
}

export function Advertising({ placement, contextText = "", locale = "ja", showSponsor = false }: AdvertisingProps) {
  if (!isAdvertisingEnabled(process.env.HUB_ADVERTISING_ENABLED)) return null;
  if (String(process.env.HUB_ADS_PROVIDER) === "static-demo") {
    return placement === "shopping" || placement === "hubpedia-article-bottom" ? null : <StaticDemoAd placement={placement} />;
  }
  if (String(process.env.HUB_ADS_PROVIDER) === "first-party") {
    const placementKeys: Record<HubAdPlacement, string> = {
      home: "home.feed.inline", "hubpedia-index": "hubpedia.index.inline",
      "hubpedia-article": "article.inline.first", "hubpedia-article-bottom": "article.footer",
      shopping: "shopping.catalog.inline",
    };
    return <FirstPartyAdSlot placementKey={placementKeys[placement]} variant={placement==="home"?"feed":placement.startsWith("hubpedia-article")?"article":undefined} context={{
      pageType: placement.startsWith("hubpedia-article") ? "article" : placement === "hubpedia-index" ? "index" : placement === "shopping" ? "catalog" : "feed",
      pageCategory: placement.startsWith("hubpedia") ? "hubpedia" : placement === "shopping" ? "shopping" : "community",
      contentKeywords: contextText.split(/\s+/u).filter(Boolean).slice(0, 20), language: locale,
    }} />;
  }

  const slots: Record<HubAdPlacement, string | undefined> = {
    home: process.env.HUB_ADSENSE_SLOT_HOME,
    "hubpedia-index": process.env.HUB_ADSENSE_SLOT_HUBPEDIA,
    "hubpedia-article": process.env.HUB_ADSENSE_SLOT_HUBPEDIA_ARTICLE,
    "hubpedia-article-bottom": process.env.HUB_ADSENSE_SLOT_HUBPEDIA_ARTICLE_BOTTOM,
    shopping: process.env.HUB_ADSENSE_SLOT_SHOPPING,
  };
  const formats: Record<HubAdPlacement, string | undefined> = {
    home: process.env.HUB_ADSENSE_FORMAT_HOME,
    "hubpedia-index": process.env.HUB_ADSENSE_FORMAT_HUBPEDIA,
    "hubpedia-article": process.env.HUB_ADSENSE_FORMAT_HUBPEDIA_ARTICLE,
    "hubpedia-article-bottom": process.env.HUB_ADSENSE_FORMAT_HUBPEDIA_ARTICLE_BOTTOM,
    shopping: process.env.HUB_ADSENSE_FORMAT_SHOPPING,
  };
  const clientId = normalizeAdSenseClientId(process.env.HUB_ADSENSE_CLIENT_ID);
  const slotId = normalizeAdSenseSlotId(slots[placement]);
  const format = normalizeAdSenseFormat(formats[placement]);
  const fullWidthResponsive = normalizeFullWidthResponsive(process.env.HUB_ADSENSE_FULL_WIDTH_RESPONSIVE);
  const sponsorCampaigns = parseSponsorCampaigns(process.env.HUB_SPONSOR_CAMPAIGNS_JSON);
  let sponsor = selectSponsorCampaign(sponsorCampaigns, {
    placement,
    locale,
    text: contextText,
    rotationHours: normalizeSponsorRotationHours(process.env.HUB_SPONSOR_ROTATION_HOURS),
  });
  if (!sponsor && showSponsor) {
    const legacyUrl = normalizeSponsorUrl(process.env.HUB_SPONSOR_URL);
    if (legacyUrl) {
      sponsor = {
        id: "legacy-home-sponsor",
        title: process.env.HUB_SPONSOR_TITLE?.trim() || "スポンサー",
        copy: process.env.HUB_SPONSOR_COPY?.trim() || "スポンサーからのお知らせです。",
        url: legacyUrl,
        placements: ["home"],
        locales: [],
        keywords: [],
        requireKeywordMatch: false,
        weight: 1,
      } satisfies SponsorCampaign;
    }
  }

  if (!sponsor && !(clientId && slotId)) return null;
  const adsenseOnly = Boolean(clientId && slotId) && !sponsor;

  return (
    <aside
      className={`advertising${adsenseOnly ? " advertising--adsense-only" : ""}`}
      aria-label="広告"
      data-ad-placement={placement}
    >
      <span className="advertising__label">広告</span>
      {sponsor ? (
        <a
          className="advertising__card"
          href={sponsor.url}
          target="_blank"
          rel="sponsored nofollow noopener noreferrer"
          data-sponsor-campaign={sponsor.id}
        >
          <strong>{sponsor.title}</strong>
          <span>{sponsor.copy}</span>
          <small>スポンサーサイトを見る ↗</small>
        </a>
      ) : null}
      {clientId && slotId ? (
        <AdSenseUnit
          clientId={clientId}
          slotId={slotId}
          format={format}
          fullWidthResponsive={fullWidthResponsive}
        />
      ) : null}
    </aside>
  );
}
