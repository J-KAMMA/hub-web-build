import type { Metadata } from "next";

import { V2ProfileConnectionsPage } from "@/components/v2/v2-profile-connections-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "フォロワー | Hub v2",
};

export default async function V2FollowersPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <V2ProfileConnectionsPage handle={handle} kind="followers" />;
}
