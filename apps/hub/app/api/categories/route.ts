import { NextResponse } from "next/server";
import { HUB_CATEGORIES } from "@/lib/hub-taxonomy";

export async function GET() {
  return NextResponse.json({ version: 1, categories: HUB_CATEGORIES }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
}
