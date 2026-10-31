import { clientThreadPostControls } from "@/lib/server/client-thread-post-controls";
export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  return clientThreadPostControls(request, (await params).postId, "history");
}
