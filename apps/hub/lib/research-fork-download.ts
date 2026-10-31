import {normalizeHubOrigin} from './hub-network-client';
import {parseResearchForkPackage,researchForkPackagePath,RESEARCH_FORK_BYTES} from './research-fork-package';

/** Fetch directly from the selected Hub; no local login, cookies, or redirects. */
export async function readResearchForkPackage(origin:string,id:string,signal?:AbortSignal) {
  origin=normalizeHubOrigin(origin);
  const response=await fetch(origin+researchForkPackagePath(id),{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  const length=response.headers.get('Content-Length');
  if(!response.ok||!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type')??'')){await response.body?.cancel().catch(()=>{});throw Error('公開プロジェクトを取得できませんでした。');}
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>RESEARCH_FORK_BYTES)){await response.body.cancel();throw Error('公開プロジェクトは合計1MBまでです。');}
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body='';
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>RESEARCH_FORK_BYTES)throw Error('公開プロジェクトは合計1MBまでです。');body+=decoder.decode(value,{stream:true});}
    body+=decoder.decode();
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  return parseResearchForkPackage(JSON.parse(body),origin,id);
}
