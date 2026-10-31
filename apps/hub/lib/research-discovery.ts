import {researchDocumentHref,RESEARCH_LINK_KINDS,researchTargetId,researchTargetPath,researchLinkLabels,type ResearchLinkKind} from './research-workspace';
import {contentShareReference} from './content-share';
import {withSocialStreamReturn} from './social-stream-return';

export type ResearchDiscoveryItem = {id:string;title:string;href:string;kind?:string;projectTitle?:string;version?:number};
const text = (value:unknown,max:number):value is string => typeof value === 'string' && value.length > 0 && value.length <= max && Boolean(value.trim()) && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
const segment = (value:unknown):value is string => text(value,240) && value !== '.' && value !== '..' && !/[\/\\]/u.test(value);
const invalid = ():never => {throw Error('関連する研究の応答を確認できません。');};

export type ResearchSourceContext={page?:number;channelId?:string;returnTo?:string};
export function researchDiscoverySource(kind:unknown,targetId:unknown,context:ResearchSourceContext={}):{href:string;label:string}|null {
  if(typeof kind!=='string'||!RESEARCH_LINK_KINDS.includes(kind as ResearchLinkKind)||!segment(targetId))return null;
  const type=kind as ResearchLinkKind,id=researchTargetId(type,targetId);
  if(id!==targetId)return null;
  let href=researchTargetPath(type,id);
  if(type==='thread'&&Number.isSafeInteger(context.page)&&(context.page??1)>1)href+=`?page=${context.page}`;
  if(type==='community'&&segment(context.channelId))href+=`&channel=${encodeURIComponent(context.channelId)}`;
  if(type==='thread'||type==='community')href=withSocialStreamReturn(href,context.returnTo);
  return href.length<=2048?{href,label:researchLinkLabels[type]}:null;
}

export function researchSourceReturn(raw:unknown):{href:string;label:string}|null {
  if(!text(raw,2048)||!raw.startsWith('/v2/'))return null;
  for(const kind of RESEARCH_LINK_KINDS){
    const prefix=researchTargetPath(kind,'');
    if(!raw.startsWith(prefix))continue;
    try{
      const url=new URL(raw,'https://hub.invalid');
      if(url.hash)return null;
      const keys=kind==='thread'?['page','returnTo']:kind==='community'?['community','channel','returnTo']:kind==='music'?['work']:[];
      if([...url.searchParams.keys()].some(key=>!keys.includes(key)||url.searchParams.getAll(key).length!==1))return null;
      const source=researchDiscoverySource(kind,decodeURIComponent(raw.slice(prefix.length).split(/[?&#]/u)[0]),{
        page:url.searchParams.has('page')?Number(url.searchParams.get('page')):undefined,
        channelId:url.searchParams.get('channel')??undefined,returnTo:url.searchParams.get('returnTo')??undefined,
      });
      return source?.href===raw?source:null;
    }catch{return null;}
  }
  return null;
}

export function checkedResearchDiscovery(value:unknown,related:boolean):ResearchDiscoveryItem[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const body=value as Record<string,unknown>, items=body[related?'projects':'updates'];
  if (!Array.isArray(items) || items.length>20 || Object.hasOwn(body,related?'updates':'projects')) return invalid();
  const seen=new Set<string>();
  return items.map(raw=>{
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const item=raw as Record<string,unknown>;
    if (!segment(item.id) || !text(item.title,240)) return invalid();
    let href:string, key:string;
    if (related) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(item.id)) return invalid();
      href=`/v2/research/${encodeURIComponent(item.id)}`; key=item.id;
      if (item.href!==undefined && item.href!==href) return invalid();
    } else {
      if (!text(item.updatedAt,64) || !Number.isFinite(Date.parse(item.updatedAt)) || typeof item.kind !== 'string' || !['research','article','video','music'].includes(item.kind)) return invalid();
      key=`${item.kind}:${item.id}`;
      if (item.kind==='research') {
        if (!segment(item.projectId) || !text(item.projectTitle,240) || !Number.isSafeInteger(item.version) || (item.version as number)<1) return invalid();
        href=researchDocumentHref(item.projectId,item.id,item.version as number);key+=`:${item.projectId}`;
        const legacy=`/v2/research/${encodeURIComponent(item.projectId)}?document=${encodeURIComponent(item.id)}`;
        if (item.href!==href && item.href!==legacy) return invalid();
      } else if (item.kind==='music') {
        href=`/v2/music?work=${encodeURIComponent(item.id)}`;
        if (contentShareReference(href)?.kind!=='music' || (item.href!==href && item.href!==`/v2/music/works/${encodeURIComponent(item.id)}` && item.href!==`/v2/music?q=${encodeURIComponent(item.title)}`)) return invalid();
      } else {
        href=`/v2/${item.kind==='article'?'articles':'videos'}/${encodeURIComponent(item.id)}`;
        if (item.href!==href) return invalid();
      }
    }
    if (seen.has(key)) return invalid();seen.add(key);
    return {id:item.id,title:item.title,href,...(!related?{kind:String(item.kind)}:{}),...(item.kind==='research'?{projectTitle:item.projectTitle as string,version:item.version as number}:{})};
  });
}
