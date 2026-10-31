import type { Metadata } from "next";

import { V2ListingsPage } from "@/components/v2/v2-listings-page";

import "../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "イベント | Hub v2" };

export default function V2EventsPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string; create?: string; listing?: string }> }) {
  return <V2ListingsPage kind="events" searchParams={searchParams} />;
}
