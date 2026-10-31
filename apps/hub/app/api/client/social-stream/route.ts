import { NextResponse } from 'next/server';
import { getSocialStream } from '@/lib/server/social-stream';
import { SocialStreamInputError, SocialStreamItemTooLargeError } from '@/lib/social-stream';
import { DesktopHubAuthenticationError } from '@/lib/server/desktop-hub-auth';
import { HubAuthenticationError, HubSuspendedError } from '@/lib/server/hub-session';

const headers={ 'Cache-Control':'private, no-store',Vary:'Authorization, Cookie, X-Hub-Client' };
export async function GET(request:Request) {
  try{return NextResponse.json(await getSocialStream(request),{headers});}
  catch(error){
    const status=error instanceof SocialStreamInputError?400:error instanceof SocialStreamItemTooLargeError?413:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError||error instanceof DesktopHubAuthenticationError?401:503;
    return NextResponse.json({error:status===400?'invalid_request':status===413?'social_stream_item_too_large':status===401?'authentication_failed':status===403?'suspended':'social_stream_unavailable'},{status,headers});
  }
}
