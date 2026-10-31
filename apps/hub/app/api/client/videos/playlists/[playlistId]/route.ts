import { clientVideoPlaylists } from '@/lib/server/client-video-playlists';
type Context = { params: Promise<{ playlistId: string }> };
export function PATCH(request: Request, { params }: Context) { return clientVideoPlaylists(request, params, 'update'); }
export function DELETE(request: Request, { params }: Context) { return clientVideoPlaylists(request, params, 'delete'); }
