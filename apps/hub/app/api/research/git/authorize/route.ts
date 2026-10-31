import {getHubD1} from '@/lib/server/hub-d1';
import {authorizeResearchGit} from '@/lib/server/research-git';
import {readPdfBytes} from '@/lib/server/research-pdfs';
import {authorizeGitApplication} from '@/lib/server/research-git-proposals';
export async function POST(request:Request) {
  const headers={'Cache-Control':'no-store'};
  try {
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPdfBytes(request,1024)));
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['projectId','write','review'].includes(key))||typeof body.projectId!=='string'||typeof body.write!=='boolean'||body.review!==undefined&&(typeof body.review!=='string'||!body.write))return Response.json({allowed:false},{status:400,headers});
    const authorization=request.headers.get('authorization') ?? '';
    if(authorization && !authorization.startsWith('Bearer '))return Response.json({allowed:false},{status:403,headers});
    const db=getHubD1(),allowed=await authorizeResearchGit(db,body.projectId,body.write,authorization.slice(7))&&(body.review===undefined||await authorizeGitApplication(db,body.projectId,body.review));
    return Response.json({allowed},{status:allowed?200:403,headers});
  }catch{return Response.json({allowed:false},{status:503,headers});}
}
