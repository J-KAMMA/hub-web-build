import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { videoChannelResponse } from "@/lib/server/video-channel-route";

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  return videoChannelResponse(request, (await params).handle, getOptionalHubViewerProfile);
}
