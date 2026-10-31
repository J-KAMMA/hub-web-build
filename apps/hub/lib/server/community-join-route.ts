import {CommunityMembershipError} from './d1-community-management';
import 'server-only';
import {CommunityJoinError} from './community-join';
import {HubAuthenticationError,HubSuspendedError} from './hub-session';
import {DesktopHubAuthenticationError} from './desktop-hub-auth';
export const joinHeaders={'Cache-Control':'private, no-store'};
export const joinJson=(value:unknown,status=200)=>Response.json(value,{status,headers:joinHeaders});
export function joinFailure(e:unknown){const status=e instanceof CommunityJoinError||e instanceof CommunityMembershipError?e.status:e instanceof HubSuspendedError?403:e instanceof HubAuthenticationError||e instanceof DesktopHubAuthenticationError?401:503;return joinJson({error:e instanceof CommunityJoinError||e instanceof CommunityMembershipError?e.message:status===401?'ログインしてください。':'参加手続きを処理できませんでした。'},status);}
export function joinQuery(request:Request){if(new URL(request.url).searchParams.size)throw new CommunityJoinError('指定が不正です。',400);}
export async function readJoinInput(request:Request){const reader=request.body?.getReader();if(!reader)throw new CommunityJoinError('入力がありません。',400);const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>98304){await reader.cancel();return joinJson({error:'入力が大きすぎます。'},413);}chunks.push(value);}try{const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await new Blob(chunks as BlobPart[]).arrayBuffer()));if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();return input;}catch{throw new CommunityJoinError('入力が不正です。',400);}}
