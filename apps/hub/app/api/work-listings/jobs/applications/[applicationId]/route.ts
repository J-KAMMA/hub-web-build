import { NextResponse } from "next/server";
import { specialistMarketDeniedResponse } from "@/lib/specialist-market-policy";

const disabled = () =>
  NextResponse.json(specialistMarketDeniedResponse("hub-application"), {
    status: 410,
    headers: { "cache-control": "no-store" },
  });

export const GET = disabled;
export const POST = disabled;
export const PATCH = disabled;
export const DELETE = disabled;
