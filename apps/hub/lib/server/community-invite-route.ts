import 'server-only';
import {CommunityInviteError} from './community-invite';
import {HubAuthenticationError,HubSuspendedError} from './hub-session';
import {DesktopHubAuthenticationError} from './desktop-hub-auth';
export const inviteHeaders={'Cache-Control':'private, no-store'};
export const inviteJson=(value:unknown,status=200)=>Response.json(value,{status,headers:inviteHeaders});
export function inviteFailure(e:unknown){const status=e instanceof CommunityInviteError?e.status:e instanceof HubSuspendedError?403:e instanceof HubAuthenticationError||e instanceof DesktopHubAuthenticationError?401:503;return inviteJson({error:e instanceof CommunityInviteError?e.message:status===401?'ログインしてください。':'招待を処理できませんでした。'},status);}
export function inviteQuery(request:Request){if(new URL(request.url).searchParams.size)throw new CommunityInviteError('指定が不正です。',400);}
export async function readInviteInput(request:Request){const reader=request.body?.getReader();if(!reader)throw new CommunityInviteError('入力がありません。',400);const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>98304){await reader.cancel();return inviteJson({error:'入力が大きすぎます。'},413);}chunks.push(value);}try{const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await new Blob(chunks as BlobPart[]).arrayBuffer()));if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();return input;}catch{throw new CommunityInviteError('入力が不正です。',400);}}
