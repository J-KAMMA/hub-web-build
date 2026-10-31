import { NextResponse } from "next/server";
import {
  HUB_FORBIDDEN_REVENUE_SOURCES,
  HUB_FREE_CAPABILITIES,
  HUB_MONETIZATION_POLICY_VERSION,
  HUB_PERSONAL_NODE_PLANS,
  HUB_REVENUE_PRINCIPLE,
  HUB_REVENUE_RATES,
  HUB_WORK_COMMISSIONS_FLAG,
} from "@/lib/monetization-policy";

export function GET() {
  return NextResponse.json({
    version: HUB_MONETIZATION_POLICY_VERSION,
    principle: HUB_REVENUE_PRINCIPLE,
    freeCapabilities: HUB_FREE_CAPABILITIES,
    forbiddenRevenueSources: HUB_FORBIDDEN_REVENUE_SOURCES,
    rates: HUB_REVENUE_RATES,
    personalNodePlans: HUB_PERSONAL_NODE_PLANS,
    workCommissionsFlag: HUB_WORK_COMMISSIONS_FLAG,
    billingBoundary: {
      social: "free",
      userOwnedCompute: "free",
      generalCommerce: "seller_fee",
      workCommissions: "commission_fee_when_enabled",
      tips: "no_fee",
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
