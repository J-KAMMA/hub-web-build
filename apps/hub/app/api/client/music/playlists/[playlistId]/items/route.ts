import { clientMusicPlaylists } from '@/lib/server/client-music-playlists';
export async function PUT(request: Request, { params }: { params: Promise<{ playlistId: string }> }) {
  return clientMusicPlaylists(request, 'items', (await params).playlistId);
}
