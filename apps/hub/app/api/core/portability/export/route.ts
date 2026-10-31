import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  buildPortableProfileArchive,
  recordPortabilityExport,
} from "@/lib/server/d1-external-protocols";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const archive = await buildPortableProfileArchive(database, profile.id);
    const recordCount = archive.posts.length
      + archive.follows.length
      + archive.lists.length
      + archive.bookmarks.length
      + archive.externalProtocolLinks.length;
    await recordPortabilityExport(database, profile.id, recordCount);
    return NextResponse.json(archive, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="hub-${profile.handle}-export.json"`,
        Vary: "Cookie",
      },
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    throw error;
  }
}
