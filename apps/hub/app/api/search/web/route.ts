import { NextResponse } from "next/server";

// Public Web search now belongs to the desktop browser. Keep the legacy route
// inert so older clients cannot trigger a paid search-provider request.
export async function GET() {
  return NextResponse.json({ configured: false, results: [], retired: true }, { status: 410 });
}
