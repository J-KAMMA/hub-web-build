import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { videoChannelResponse } from "@/lib/server/video-channel-route";

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  return videoChannelResponse(request, (await params).handle, getOptionalHubSessionProfile);
}
