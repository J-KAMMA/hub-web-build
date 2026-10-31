import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readCommunityChannelPolicies,mutateCommunityChannelPolicy,CommunityChannelPolicyError} from '@/lib/server/community-channel-policy';
import {channelPolicyJson,channelPolicyFailure,channelPolicyOffset,readChannelPolicyInput} from '@/lib/server/community-channel-policy-route';
type Context={params:Promise<{communityId:string}>};
export async function GET(request:Request,{params}:Context){
  try{const offset=channelPolicyOffset(new URL(request.url).searchParams),db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params;
    return channelPolicyJson(await readCommunityChannelPolicies(db,actor.id,communityId,offset));
  }catch(error){return channelPolicyFailure(error);}
}
export async function POST(request:Request,{params}:Context){

  try{
    if(new URL(request.url).searchParams.size)throw new CommunityChannelPolicyError('指定が不正です。',400);
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params,input=await readChannelPolicyInput(request);
    if(input instanceof Response)return input;
    return channelPolicyJson(await mutateCommunityChannelPolicy(db,actor.id,communityId,input));
  }catch(error){return channelPolicyFailure(error);}
}
