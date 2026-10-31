import { getHubD1 } from '@/lib/server/hub-d1';
import { getD1ExternalVideo } from '@/lib/server/d1-videos';
import { getOptionalHubViewerProfile } from '@/lib/server/desktop-hub-auth';
export async function GET(request: Request, {params}: {params:Promise<{videoId:string}>}) {
  const headers={'Cache-Control':'no-store'};
  try {
    const database=getHubD1();
    const viewer=await getOptionalHubViewerProfile(request,database);
    const video=await getD1ExternalVideo(database,(await params).videoId,viewer?.id??null);
    return Response.json(video?{video}:{error:'not_found'},{status:video?200:404,headers});
  } catch {return Response.json({error:'video_unavailable'},{status:503,headers});}
}
