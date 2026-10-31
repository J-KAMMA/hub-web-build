import {getHubD1} from '@/lib/server/hub-d1';
import {hubNetworkCatalog,NETWORK_KINDS,type NetworkKind} from '@/lib/server/hub-network-catalog';
import {postManifest} from '@/lib/hub-peer-catalog.mjs';
import {isSecureRequest} from '@/lib/server/hub-auth-route';
import {hubCatalogResearchQuery} from '@/lib/hub-network-client';
import { DEFAULT_INSTANCE_ORIGIN } from "@/lib/instance-origin";

export const dynamic='force-dynamic';
// Only server configuration chooses the Music Worker origin (same rule as the work page); never the request.
function configuredMusicOrigin():string|null{
  const configured=process.env.HUB_PUBLIC_ORIGIN??DEFAULT_INSTANCE_ORIGIN;
  try{
    const url=new URL(configured);
    if(/[\s\u0000-\u001f]/.test(configured)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))return null;
    return url.origin;
  }catch{return null;}
}
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams,kind=params.get('kind') as NetworkKind;
  // Anonymous public metadata only; other Hubs read it directly without cookies.
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};
  if(!NETWORK_KINDS.includes(kind))return Response.json({error:'invalid_kind'},{status:400,headers});
  let query='';
  try{
    if([...params.keys()].some(key=>!['kind','q','manifest'].includes(key)||params.getAll(key).length!==1)||params.has('q')&&kind!=='research')throw Error();
    query=kind==='research'?hubCatalogResearchQuery(params.get('q')??''):'';
    if(params.get('manifest')==='1'&&kind!=='post')throw Error();
  }catch{return Response.json({error:'invalid_query'},{status:400,headers});}
  try {
    const catalog=kind==='music'?await hubNetworkCatalog(getHubD1(),kind,query,{musicOrigin:configuredMusicOrigin()}):await hubNetworkCatalog(getHubD1(),kind,query);
    if(params.get('manifest')==='1'){
      if(kind!=='post')return Response.json({error:'invalid_kind'},{status:400,headers});
      // Next's internal request URL may use localhost behind a proxy or in next dev.
      const host=request.headers.get('x-forwarded-host')?.split(',',1)[0]?.trim()||request.headers.get('host')||new URL(request.url).host;
      return Response.json(await postManifest(`${isSecureRequest(request)?'https':'http'}://${host}`,catalog),{headers});
    }
    return Response.json(catalog,{headers});
  }
  catch {return Response.json({error:'catalog_unavailable'},{status:503,headers});}
}
