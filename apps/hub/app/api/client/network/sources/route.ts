import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile, DesktopHubAuthenticationError} from '@/lib/server/desktop-hub-auth';
import {HubSuspendedError} from '@/lib/server/hub-session';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {listHubSources, updateHubSources, networkSourcesJson as json} from '@/lib/server/hub-network-sources';

function failure(error:unknown) {
  return json({error:'network_sources_unavailable'},error instanceof HubSuspendedError ? 403 : error instanceof DesktopHubAuthenticationError ? 401 : 503);
}
export async function GET(request:Request) {
  try {const db=getHubD1(), profile=await requireDesktopHubProfile(request,db);return json({sources:await listHubSources(db,profile.id)});}
  catch(error) {return failure(error);}
}
export async function POST(request:Request) {
  // Native requests have no browser Origin; even those must present a fresh desktop assertion.
  if(request.headers.has('origin') && !hasSameOrigin(request)) return json({error:'invalid_origin'},403);
  try {const db=getHubD1(), profile=await requireDesktopHubProfile(request,db);return await updateHubSources(request,db,profile.id);}
  catch(error) {return failure(error);}
}
