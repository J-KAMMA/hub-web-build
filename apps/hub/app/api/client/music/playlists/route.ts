import { clientMusicPlaylists } from '@/lib/server/client-music-playlists';
export const GET = (request: Request) => clientMusicPlaylists(request, 'list');
export const POST = (request: Request) => clientMusicPlaylists(request, 'create');
