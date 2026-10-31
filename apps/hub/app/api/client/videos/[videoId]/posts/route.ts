import { clientVideoPosts } from '@/lib/server/client-video-posts';
type Context = { params: Promise<{ videoId: string }> };
export function GET(request: Request, { params }: Context) { return clientVideoPosts(request, params, 'list'); }
export function POST(request: Request, { params }: Context) { return clientVideoPosts(request, params, 'create'); }
