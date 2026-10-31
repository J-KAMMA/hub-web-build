import { NextResponse } from "next/server";

import { getSnapshotRouteData } from "@/lib/server/snapshot-route-data";

export async function GET() {
  try {
    return NextResponse.json(getSnapshotRouteData());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 }
    );
  }
}
