import { clientThreadPostControls } from "@/lib/server/client-thread-post-controls";
type Context = { params: Promise<{ postId: string }> };
export async function GET(request: Request, { params }: Context) {
  return clientThreadPostControls(request, (await params).postId, "relationship_get");
}
export async function PUT(request: Request, { params }: Context) {
  return clientThreadPostControls(request, (await params).postId, "relationship_set");
}
