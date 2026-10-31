import 'server-only';
import {CommunityChannelPolicyError} from './community-channel-policy';
import {HubAuthenticationError,HubSuspendedError} from './hub-session';
import {DesktopHubAuthenticationError} from './desktop-hub-auth';
export const channelPolicyHeaders={'Cache-Control':'private, no-store'};
export const channelPolicyJson=(value:unknown,status=200)=>Response.json(value,{status,headers:channelPolicyHeaders});
export function channelPolicyFailure(error:unknown){
  const status=error instanceof CommunityChannelPolicyError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError||error instanceof DesktopHubAuthenticationError?401:503;
  return channelPolicyJson({error:error instanceof CommunityChannelPolicyError?error.message:status===401?'ログインしてください。':'チャンネル設定を処理できませんでした。'},status);
}
export function channelPolicyOffset(query:URLSearchParams){
  if([...query.keys()].some(key=>key!=='offset')||query.getAll('offset').length>1)throw new CommunityChannelPolicyError('ページ指定が不正です。',400);
  const value=query.get('offset')??'0',offset=Number(value);
  if(!/^(0|[1-9][0-9]*)$/.test(value)||(!Number.isSafeInteger(offset)||offset>Number.MAX_SAFE_INTEGER-20))throw new CommunityChannelPolicyError('ページ指定が不正です。',400);
  return offset;
}
export async function readChannelPolicyInput(request:Request){
  const reader=request.body?.getReader();if(!reader)throw new CommunityChannelPolicyError('入力がありません。',400);
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();return channelPolicyJson({error:'入力が大きすぎます。'},413);}chunks.push(value);}
  try{const input:unknown=JSON.parse(await new Blob(chunks as BlobPart[]).text());if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();return input;}catch{throw new CommunityChannelPolicyError('入力が不正です。',400);}
}
