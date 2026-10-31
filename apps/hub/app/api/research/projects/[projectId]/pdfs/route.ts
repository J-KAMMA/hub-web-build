import {getHubD1,getHubMedia} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {getOptionalHubSessionProfile,requireHubSessionProfile,HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
import {researchPdfProject,listResearchPdfs,readPdfBytes,uploadResearchPdf,scanResearchPdf,setResearchPdfVisibility,downloadResearchPdf} from '@/lib/server/research-pdfs';
type Context={params:Promise<{projectId:string}>};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const failure=(error:unknown)=>json({error:error instanceof ResearchWorkspaceError?error.message:'PDFを処理できませんでした。'},error instanceof ResearchWorkspaceError?error.status:error instanceof HubAuthenticationError?401:error instanceof HubSuspendedError?403:503);
export async function GET(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),viewer=await getOptionalHubSessionProfile(request,db),{projectId}=await params,query=new URL(request.url).searchParams;
    return query.has('download') && query.get('pdf')
      ? await downloadResearchPdf(db,getHubMedia(),projectId,query.get('pdf')!,viewer?.id)
      : json({pdfs:await listResearchPdfs(db,projectId,viewer?.id)});
  } catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context) {
  if(!hasSameOrigin(request))return json({error:'不正なリクエストです。'},403);
  try {
    const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId}=await params;
    await researchPdfProject(db,projectId,viewer.id,true);
    const query=new URL(request.url).searchParams;
    if(query.get('action')==='upload') {
      const bytes=await readPdfBytes(request);
      return json(await uploadResearchPdf(db,getHubMedia(),projectId,viewer.id,bytes,query.get('title') ?? '',query.get('series') ?? undefined),201);
    }
    const body=JSON.parse(new TextDecoder().decode(await readPdfBytes(request,8192)));
    if(!body || typeof body!=='object' || Array.isArray(body) || typeof body.id!=='string' || body.id.length>100) return json({error:'入力を確認してください。'},400);
    if(body.action==='scan')return json(await scanResearchPdf(db,getHubMedia(),projectId,body.id,viewer.id));
    if(body.action==='visibility'){await setResearchPdfVisibility(db,projectId,body.id,viewer.id,body.visibility);return json({});}
    return json({error:'操作が不正です。'},400);
  } catch(error){return error instanceof SyntaxError?json({error:'入力が不正です。'},400):failure(error);}
}
