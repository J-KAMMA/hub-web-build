import {getHubD1} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {requireHubSessionProfile, HubAuthenticationError, HubSuspendedError} from '@/lib/server/hub-session';
import {updateHubSources, listHubSources, networkSourcesJson as json} from '@/lib/server/hub-network-sources';

function failure(error:unknown) {
  return json({error:error instanceof HubAuthenticationError ? 'Hubにログインしてください。' : '接続先を読み込めませんでした。'}, error instanceof HubSuspendedError ? 403 : error instanceof HubAuthenticationError ? 401 : 503);
}
export async function GET(request:Request) {
  try {const db=getHubD1(), profile=await requireHubSessionProfile(request, db); return json({sources:await listHubSources(db, profile.id)});}
  catch(error) {return failure(error);}
}
export async function POST(request:Request) {
  if(!hasSameOrigin(request)) return json({error:'この画面から操作してください。'}, 403);
  try {
    const db=getHubD1(), profile=await requireHubSessionProfile(request, db);
    return await updateHubSources(request,db,profile.id);
  } catch(error) {return failure(error);}
}
