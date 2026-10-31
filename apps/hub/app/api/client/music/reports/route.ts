import { clientExternalMedia } from '@/lib/server/client-external-media';
export function POST(request: Request) { return clientExternalMedia(request, 'music_report'); }
