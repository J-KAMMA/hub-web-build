import 'server-only';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { getResearchProject } from './d1-research';
import { ResearchWorkspaceError } from './research-workspace';
import { isRedirectResponse } from "@/lib/redirect-guard";

export const MAX_RESEARCH_PDF_BYTES = 10 * 1024 * 1024;
type PdfRow = {id:string;projectId:string;title:string;visibility:string;version:number;seriesId:string;objectKey:string;sha256:string;size:number;scanStatus:string;createdAt:string};
const columns='id,project_id projectId,title,visibility,version,series_id seriesId,object_key objectKey,sha256,size,scan_status scanStatus,created_at createdAt';
const fail=(message:string,status=400):never=>{throw new ResearchWorkspaceError(message,status);};
export async function researchPdfProject(db:D1Database,id:string,viewer?:string,owner=false) {
  const project=await getResearchProject(db,id,viewer);
  if(!project || (project.status==='withdrawn' && project.ownerProfileId!==viewer)) return fail('プロジェクトが見つかりません。',404);
  if(owner && project.ownerProfileId!==viewer) fail('編集権限がありません。',403);
  return project;
}
function metadata(row:PdfRow) {
  const {objectKey:_,...value}=row;
  return value;
}
export async function listResearchPdfs(db:D1Database,projectId:string,viewer?:string) {
  const project=await researchPdfProject(db,projectId,viewer);
  const result=await db.prepare(`SELECT ${columns} FROM research_pdfs WHERE project_id=? AND (?=? OR (visibility='public' AND scan_status='clean')) ORDER BY created_at DESC,id DESC LIMIT 100`)
    .bind(projectId,viewer ?? '',project.ownerProfileId).all<PdfRow>();
  return result.results.map(metadata);
}
export async function readPdfBytes(request:Request,max=MAX_RESEARCH_PDF_BYTES) {
  const declared=request.headers.get('content-length');
  if(declared && (!/^\d+$/.test(declared) || Number(declared)>max)) fail('PDFは10MBまでです。',413);
  const reader=request.body?.getReader();
  if(!reader) return fail('PDFがありません。');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();return fail('PDFは10MBまでです。',413);}chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
const digest=async(bytes:Uint8Array)=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes as BufferSource)).toString('hex');
export async function uploadResearchPdf(db:D1Database,bucket:R2Bucket,projectId:string,viewer:string,bytes:Uint8Array,title:string,seriesId?:string) {
  await researchPdfProject(db,projectId,viewer,true);
  if(bytes.length>MAX_RESEARCH_PDF_BYTES) fail('PDFは10MBまでです。',413);
  if(!/^%PDF-\d\.\d[\r\n]/.test(new TextDecoder().decode(bytes.slice(0,9)))) fail('PDF形式を確認してください。',415);
  if(!title.trim() || title.length>240 || /[\x00-\x1f\x7f]/.test(title)) fail('PDFの名前を確認してください。');
  const count=await db.prepare('SELECT count(*) total FROM research_pdfs WHERE project_id=?').bind(projectId).first<{total:number}>();
  if((count?.total ?? 0)>=100) fail('PDFは全版を合わせて100件までです。',409);
  const previous=seriesId ? await db.prepare('SELECT MAX(version) version FROM research_pdfs WHERE project_id=? AND series_id=?').bind(projectId,seriesId).first<{version:number|null}>():null;
  if(seriesId && !previous?.version) fail('改訂元のPDFが見つかりません。',404);
  const id=crypto.randomUUID(),version=(previous?.version ?? 0)+1,key=`research-pdfs/${projectId}/${id}.pdf`,sha256=await digest(bytes);
  // Insert before storing: the unique version constraint resolves concurrent revisions.
  try {
    const result=await db.prepare('INSERT INTO research_pdfs(id,project_id,title,version,series_id,object_key,sha256,size,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM research_pdfs WHERE project_id=?)<100')
      .bind(id,projectId,title.trim(),version,seriesId ?? id,key,sha256,bytes.length,new Date().toISOString(),projectId).run();
    if(!result.meta.changes)fail('PDFは全版を合わせて100件までです。',409);
  } catch(error) {
    if(error instanceof Error && error.message.includes('UNIQUE constraint failed: research_pdfs.series_id'))return fail('同じPDFが改訂されました。読み直してから追加してください。',409);
    throw error;
  }
  try {await bucket.put(key,bytes,{httpMetadata:{contentType:'application/pdf'},sha256});}
  catch {await db.prepare('DELETE FROM research_pdfs WHERE id=?').bind(id).run();return fail('PDFを保存できませんでした。',503);}
  return {id,version,scanStatus:'pending'};
}
async function findPdf(db:D1Database,projectId:string,id:string,viewer?:string,owner=false) {
  const project=await researchPdfProject(db,projectId,viewer,owner);
  const row=await db.prepare(`SELECT ${columns} FROM research_pdfs WHERE project_id=? AND id=?`).bind(projectId,id).first<PdfRow>();
  if(!row || (project.ownerProfileId!==viewer && (row.visibility!=='public' || row.scanStatus!=='clean'))) return fail('PDFが見つかりません。',404);
  return row;
}
export async function scanResearchPdf(db:D1Database,bucket:R2Bucket,projectId:string,id:string,viewer:string,scan=scanPdfBytes) {
  const row=await findPdf(db,projectId,id,viewer,true);
  if(row.scanStatus==='clean' || row.scanStatus==='rejected') return {scanStatus:row.scanStatus};
  const object=await bucket.get(row.objectKey);
  if(!object || object.size!==row.size) return fail('保存したPDFを確認できません。',503);
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(await digest(bytes)!==row.sha256) return fail('保存したPDFを確認できません。',503);
  let status:string;
  try {status=await scan(bytes,row.sha256);}
  catch {status='failed';}
  // A transient failure must not overwrite a concurrent successful scan.
  await db.prepare("UPDATE research_pdfs SET scan_status=? WHERE id=? AND scan_status IN ('pending','failed')").bind(status,id).run();
  return {scanStatus:(await findPdf(db,projectId,id,viewer,true)).scanStatus};
}
export async function setResearchPdfVisibility(db:D1Database,projectId:string,id:string,viewer:string,visibility:unknown) {
  const row=await findPdf(db,projectId,id,viewer,true);
  if(visibility!=='public' && visibility!=='confidential') fail('公開範囲が不正です。');
  if(visibility==='public' && row.scanStatus!=='clean') fail('検査に合格したPDFだけ公開できます。',409);
  await db.prepare('UPDATE research_pdfs SET visibility=? WHERE id=?').bind(visibility,id).run();
}
export async function downloadResearchPdf(db:D1Database,bucket:R2Bucket,projectId:string,id:string,viewer?:string) {
  const row=await findPdf(db,projectId,id,viewer);
  if(row.scanStatus!=='clean') return fail('検査が完了していないPDFは取得できません。',409);
  const object=await bucket.get(row.objectKey);
  if(!object || object.size!==row.size) return fail('PDFを取得できません。',503);
  return new Response(object.body as ReadableStream, {headers:{
    'Content-Type':'application/pdf','Content-Length':String(row.size),'Cache-Control':'private, no-store',
    'Content-Disposition':`attachment; filename="research.pdf"; filename*=UTF-8''${encodeURIComponent(row.title.replace(/\.pdf$/i,'')+'.pdf').replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",
  }});
}
export async function scanPdfBytes(bytes:Uint8Array,sha256:string):Promise<'clean'|'rejected'> {
  const endpoint=process.env.HUB_RESEARCH_SCANNER_URL,token=process.env.HUB_RESEARCH_SCANNER_TOKEN;
  if(!endpoint || !token || token.length<32) throw new Error('scanner_unavailable');
  const url=new URL(endpoint);
  if(url.username || url.password || url.search || url.hash || (url.protocol!=='https:' && !(process.env.NODE_ENV==='development' && url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Error('scanner_unavailable');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/pdf','X-Content-Sha256':sha256,'X-Content-Size':String(bytes.length)},body:bytes as BodyInit,redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(!response.ok||isRedirectResponse(response)) throw new Error('scanner_unavailable');
  const result=JSON.parse(new TextDecoder().decode(await readPdfBytes(new Request('http://localhost',{method:'POST',body:response.body,duplex:'half'} as RequestInit),8192)));
  if(result.sha256!==sha256 || result.size!==bytes.length || !['clean','infected'].includes(result.status)) throw new Error('scanner_invalid');
  return result.status==='clean'?'clean':'rejected';
}
