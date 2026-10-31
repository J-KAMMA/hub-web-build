import { clientMusicPlaylists } from '@/lib/server/client-music-playlists';
type Context = { params: Promise<{ playlistId: string }> };
export async function PATCH(request: Request, { params }: Context) {
  return clientMusicPlaylists(request, 'update', (await params).playlistId);
}
export async function DELETE(request: Request, { params }: Context) {
  return clientMusicPlaylists(request, 'delete', (await params).playlistId);
}
