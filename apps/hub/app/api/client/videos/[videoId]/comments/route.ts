import { clientVideoComments } from '@/lib/server/client-video-comments';
type Context = { params: Promise<{ videoId: string }> };
export function GET(request: Request, { params }: Context) { return clientVideoComments(request, params, 'list'); }
export function POST(request: Request, { params }: Context) { return clientVideoComments(request, params, 'create'); }
