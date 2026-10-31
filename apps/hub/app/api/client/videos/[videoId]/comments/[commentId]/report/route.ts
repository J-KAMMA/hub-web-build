import { clientVideoComments } from '@/lib/server/client-video-comments';
type Context = { params: Promise<{ videoId: string; commentId: string }> };
export function POST(request: Request, { params }: Context) { return clientVideoComments(request, params, 'report'); }
