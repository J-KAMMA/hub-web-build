import { clientVideoPlaylists } from '@/lib/server/client-video-playlists';
export function GET(request: Request) { return clientVideoPlaylists(request, Promise.resolve({}), 'list'); }
export function POST(request: Request) { return clientVideoPlaylists(request, Promise.resolve({}), 'create'); }
