import { putCommentPolicy } from "@/lib/server/video-comment-owner-routes";

export function PUT(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  return putCommentPolicy(request, params);
}
