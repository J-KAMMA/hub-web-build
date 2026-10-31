import type { Metadata } from "next";

import { MarketTicketCheckin } from "@/components/market-ticket-checkin";
import { V2MarketShell } from "@/components/v2/v2-market-shell";

import "../../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "チケットの入場確認 | マーケット | Hub v2" };

/* 主催者の入場確認。既存の MarketTicketCheckin をそのまま。challenge と nonce は QR の URL から来る。 */
export default async function V2MarketTicketCheckinPage({ searchParams }: { searchParams: Promise<{ challenge?: string; nonce?: string }> }) {
  const params = await searchParams;
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market/tickets" title="入場確認">
      <MarketTicketCheckin challengeId={params.challenge ?? ""} nonce={params.nonce ?? ""} />
    </V2MarketShell>
  );
}
