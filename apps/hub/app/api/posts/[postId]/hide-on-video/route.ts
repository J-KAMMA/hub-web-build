import { setHideOnVideo } from "@/lib/server/video-comment-owner-routes";

type Context = { params: Promise<{ postId: string }> };
export function POST(request: Request, { params }: Context) {
  return setHideOnVideo(request, params, true);
}
export function DELETE(request: Request, { params }: Context) {
  return setHideOnVideo(request, params, false);
}
