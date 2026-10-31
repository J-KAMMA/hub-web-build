import {governanceJson,governanceFailure,governanceQuery,readGovernanceInput} from '@/lib/server/community-governance-access-route';
import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

import {
  createCommunityGovernanceProposalRouteData,
  getCommunityGovernanceRouteData,
} from "@/lib/server/community-route-data";

export async function GET(request:Request,context:{params:Promise<{communityId:string}>}){
 try{const offset=governanceQuery(request,true),{communityId}=await context.params;return governanceJson(await getCommunityGovernanceRouteData(request,communityId,offset));}catch(e){return governanceFailure(e);}
}

export async function POST(request:Request,{params}:{params:Promise<{communityId:string}>}){
 if(!hasSameOrigin(request))return governanceJson({error:'invalid_origin'},403);
 try{governanceQuery(request);const {communityId}=await params,input=await readGovernanceInput(request);return governanceJson(await createCommunityGovernanceProposalRouteData(request,communityId,input),201);}catch(e){return governanceFailure(e);}
}
