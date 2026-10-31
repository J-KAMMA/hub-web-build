import { clientMusicPosts } from '@/lib/server/client-music-posts';
type Context = { params: Promise<{ workId: string }> };
export function GET(request: Request, { params }: Context) { return clientMusicPosts(request, params, 'list'); }
export function POST(request: Request, { params }: Context) { return clientMusicPosts(request, params, 'create'); }
