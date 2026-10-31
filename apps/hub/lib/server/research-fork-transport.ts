import 'server-only';
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {isIP} from 'node:net';
import {normalizeHubOrigin} from '@/lib/hub-network-client';
import {parseResearchForkPackage,researchForkPackagePath,RESEARCH_FORK_BYTES} from '@/lib/research-fork-package';
import {assessHubAdHostname} from './hub-ads-landing-network-policy';
import {ResearchWorkspaceError} from './research-workspace';

let active=0;
const failure=(message='接続先Hubの公開版を取得できませんでした。',status=503)=>new ResearchWorkspaceError(message,status);
/** Workers' HTTP shim cannot pin a socket. Never silently fall back to its fetch. */
export function supportsResearchForkTransport(){
  return typeof process!=='undefined'&&process.release?.name==='node'&&Boolean(process.versions.openssl)&&!Reflect.has(globalThis,'WebSocketPair')&&!(typeof navigator!=='undefined'&&navigator.userAgent==='Cloudflare-Workers');
}
export async function readPublicResearchFork(origin:string,id:string) {
  origin=normalizeHubOrigin(origin);const path=researchForkPackagePath(id),url=new URL(origin),hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(!supportsResearchForkTransport())throw failure('このHubの実行環境では、別Hubからのfork取得はまだ利用できません。');
  if(url.protocol!=='https:')throw failure('別Hubのfork取得には公開HTTPS接続が必要です。',400);
  if(active>=4)throw failure('別Hubの取得が混み合っています。少し待って再確認してください。',429);
  active++;
  try {
    const assessment=await assessHubAdHostname(hostname);
    if(!assessment.allowed)throw failure('接続先Hubの公開ネットワークを確認できませんでした。',400);
    const address=assessment.addresses[0];
    // Use the approved literal IP, not a second DNS lookup. SNI/certificate/Host keep the original Hub identity.
    const body=await new Promise<string>((resolve,reject)=>{
      let settled=false,timeout:ReturnType<typeof setTimeout>;
      const finish=(error?:ResearchWorkspaceError,text?:string)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else resolve(text??'');req.destroy();};
      const req=request({hostname:address,family:isIP(address),port:url.port||443,path,method:'GET',agent:false,rejectUnauthorized:true,servername:isIP(hostname)?undefined:hostname,checkServerIdentity:(_host,cert)=>checkServerIdentity(hostname,cert),headers:{Host:url.host,Accept:'application/json','Accept-Encoding':'identity'},maxHeaderSize:16384},res=>{
        const length=res.headers['content-length'];
        if(res.statusCode!==200||!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type']??'')||(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')){finish(failure('接続先Hubの公開版を取得できませんでした。',[404,409,413].includes(res.statusCode??0)?res.statusCode:503));res.destroy();return;}
        if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>RESEARCH_FORK_BYTES)){finish(failure('公開プロジェクトは合計1MBまでです。',413));res.destroy();return;}
        const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
        res.on('data',(chunk:Buffer)=>{try{size+=chunk.byteLength;if(size>RESEARCH_FORK_BYTES)throw failure('公開プロジェクトは合計1MBまでです。',413);text+=decoder.decode(chunk,{stream:true});}catch(error){finish(error instanceof ResearchWorkspaceError?error:failure('公開プロジェクトの文字コードが不正です。',409));res.destroy();}});
        res.on('error',()=>finish(failure()));res.on('aborted',()=>finish(failure()));
        res.on('end',()=>{try{finish(undefined,text+decoder.decode());}catch{finish(failure('公開プロジェクトの文字コードが不正です。',409));}});
      });
      timeout=setTimeout(()=>finish(failure('接続先Hubの取得がタイムアウトしました。')),8000);
      req.on('error',error=>finish(error instanceof ResearchWorkspaceError?error:failure()));req.on('close',()=>{if(!settled)finish(failure());});req.end();
    });
    try{return await parseResearchForkPackage(JSON.parse(body),origin,id);}catch{throw failure('接続先Hubの版・ハッシュを確認できませんでした。',409);}
  }finally{active--;}
}
