import { clientVideoPlaylists } from '@/lib/server/client-video-playlists';
type Context = { params: Promise<{ playlistId: string; videoId: string }> };
export function POST(request: Request, { params }: Context) { return clientVideoPlaylists(request, params, 'add'); }
export function DELETE(request: Request, { params }: Context) { return clientVideoPlaylists(request, params, 'remove'); }
