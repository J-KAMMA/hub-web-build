import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,lstat,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {browseResearchRepository} from './research-git-browse.mjs';
import {bundleResearchRepository} from './research-git-bundle.mjs';
import {patchResearchRepository} from './research-git-patch.mjs';
import {branchesResearchRepository,applyResearchBranch} from './research-git-branches.mjs';
import {importResearchRepository,researchImportInput,researchImportHeader} from './research-git-import.mjs';
const exec=promisify(execFile),MAX_PACK=50*1024*1024;
const idPattern=/^rp_[a-f0-9]{32}$/;
async function directorySize(dir){let total=0;for(const item of await readdir(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('invalid_repository');total+=item.isDirectory()?await directorySize(name):(await lstat(name)).size;if(total>200*1024*1024)break;}return total;}
function credential(header){if(!header)return '';if(header.startsWith('Bearer '))return header.slice(7);if(!header.startsWith('Basic ')||header.length>512)return null;const value=Buffer.from(header.slice(6),'base64').toString('utf8');return value.includes(':')?value.slice(value.indexOf(':')+1):null;}
function branchBody(req,signal,limit=1024){return new Promise((resolve,reject)=>{
  const chunks=[];let size=0,finished=false;
  const done=(error)=>{if(finished)return;finished=true;req.off('data',data);req.off('end',end);req.off('error',done);signal.removeEventListener('abort',abort);if(error){req.resume();reject(error);}else resolve(Buffer.concat(chunks));};
  const data=chunk=>{size+=chunk.length;if(size>limit)done(Object.assign(Error('request_too_large'),{status:413}));else chunks.push(chunk);},end=()=>done(),abort=()=>done(signal.reason);
  req.on('data',data);req.once('end',end);req.once('error',done);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
export function hubGitAuthorizer(origin) {
  const url=new URL(origin);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw Error('invalid_hub_origin');
  return async(projectId,write,token,review)=>{
    const response=await fetch(new URL('/api/research/git/authorize',url),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({projectId,write,...(review?{review}:{})}),redirect:'error',signal:AbortSignal.timeout(10000)});
    return response.status===200 && (await response.json()).allowed===true;
  };
}
export async function createResearchGitServer({root,authorize}) {
  await mkdir(root,{recursive:true});if((await lstat(root)).isSymbolicLink())throw Error('invalid_root');root=await realpath(root);
  const empty=path.join(root,'empty'),config=path.join(root,'empty-config');await mkdir(empty,{recursive:true});await writeFile(config,'');
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP'].includes(key.toUpperCase()))),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:config,GIT_CONFIG_SYSTEM:config,GIT_TERMINAL_PROMPT:'0'};
  const flags=['-c',`core.hooksPath=${empty}`,'-c','receive.fsckObjects=true','-c','receive.denyNonFastForwards=true','-c','receive.denyDeletes=true','-c',`receive.maxInputSize=${MAX_PACK}`,'-c','http.getanyfile=false','-c','gc.auto=0'];
  const busy=new Set();
  const readAuthorization=async(id,write,token,signal,review)=>{
    signal?.throwIfAborted();let timer,onAbort;
    try{return await Promise.race([authorize(id,write,token,review),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('authorization_timeout')),10000);if(signal){onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}})]);}
    finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
  };
  const publicRead=(id,signal)=>readAuthorization(id,false,'',signal);
  return http.createServer(async(req,res)=>{
    const send=(status,message)=>{if(res.writableEnded||res.destroyed)return;if(!res.headersSent){res.writeHead(status,{'Content-Type':'text/plain','Cache-Control':'no-store',...(status===401?{'WWW-Authenticate':'Basic realm="Hub Git"'}:{})});}res.end(message);};
    const json=(status,value)=>{if(!res.writableEnded&&!res.destroyed){
      if((bundle||patch)&&req.headers.accept?.includes('text/html')){
        const message={repository_empty:'まだコミットがありません。最初のコードをpushしてから取得してください。',bundle_too_large:'全履歴が50MiBを超えています。HubのGit設定にあるclone URLで取得してください。',patch_too_large:'変更パッチが16MiBを超えています。Gitのclone URLから二版を取得してください。',no_changes:'この二版のファイル内容は同じです。',repository_busy:'このリポジトリは現在処理中です。少し待ってから再試行してください。',not_found:'公開中のリポジトリを確認できませんでした。Hubで公開範囲と接続先を確認してください。'}[value.error]||'履歴を取得できませんでした。接続先を確認し、少し待ってから再試行してください。';
        res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
        res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Git履歴の取得</title><main><h1>Git履歴を取得できませんでした</h1><p>${message}</p><p><a href="">もう一度試す</a></p></main></html>`);return;
      }
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));
    }};
    if(req.method==='GET'&&req.url==='/healthz'){send(200,'ok');return;}
    const bundle=req.url?.match(/^\/v1\/repositories\/(rp_[a-f0-9]{32})\/bundle$/);
    const browse=req.url?.match(/^\/v1\/repositories\/(rp_[a-f0-9]{32})\/commits(?:\/([a-f0-9]{40}|[a-f0-9]{64}))?$/);
    const compare=req.url?.match(/^\/v1\/repositories\/(rp_[a-f0-9]{32})\/compare\/([a-f0-9]{40}|[a-f0-9]{64})\/([a-f0-9]{40}|[a-f0-9]{64})$/);
    const patch=req.url?.match(/^\/v1\/repositories\/(rp_[a-f0-9]{32})\/patch\/([a-f0-9]{40}|[a-f0-9]{64})\/([a-f0-9]{40}|[a-f0-9]{64})$/);
    const branchRoute=req.url?.match(/^\/v1\/repositories\/(rp_[a-f0-9]{32})\/(branches|apply|check)$/);
    const importRoute=req.url?.match(/^\/v1\/repositories\/(rp_[a-f0-9]{32})\/import\/(preview|save|check)$/);
    if(importRoute){
      const [,id,operation]=importRoute,check=operation==='check',limit=check?1024:MAX_PACK;
      if(req.method!=='POST'){req.resume();json(405,{error:'method_not_allowed'});return;}
      const token=credential(req.headers.authorization);
      if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$(?![\s\S])/.test(token)){req.resume();json(401,{error:'authentication_required'});return;}
      if(req.headers['content-type']!==(check?'application/json':'application/octet-stream')||req.headers['content-encoding']&&req.headers['content-encoding']!=='identity'){req.resume();json(415,{error:'unsupported_content'});return;}
      const length=req.headers['content-length'];if(length&&(!/^\d+$/.test(length)||Number(length)>limit)){req.resume();json(413,{error:'request_too_large'});return;}
      let metadata;
      try{if(check){if(req.headers['x-hub-git-import']!==undefined)throw Object.assign(Error('invalid_import'),{status:400});}else metadata=researchImportHeader(req.headers['x-hub-git-import']);}
      catch(error){req.resume();json(error.status??400,{error:'invalid_import'});return;}
      try{if(!await readAuthorization(id,true,token)){req.resume();json(401,{error:'authentication_required'});return;}}catch{req.resume();json(503,{error:'authorization_unavailable'});return;}
      if(res.destroyed)return;if(busy.has(id)){req.resume();json(409,{error:'repository_busy'});return;}if(busy.size>=4){req.resume();json(503,{error:'repository_capacity'});return;}busy.add(id);
      const controller=new AbortController();let timedOut=false;const stop=()=>controller.abort(),timer=setTimeout(()=>{timedOut=true;controller.abort();req.resume();},20000);
      req.once('aborted',stop);req.once('error',stop);res.once('close',()=>{if(!res.writableEnded)stop();});
      try{
        const repo=path.join(root,`${id}.git`),stat=await lstat(repo).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(!stat){req.resume();json(404,{error:'not_found'});return;}if(stat.isSymbolicLink()||!stat.isDirectory()||!(await realpath(repo)).startsWith(root+path.sep))throw Error('invalid_repository');
        const bytes=await branchBody(req,controller.signal,limit);
        if(check){try{metadata=researchImportInput(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{json(400,{error:'invalid_import'});return;}}
        const authorize=()=>readAuthorization(id,true,token,controller.signal);
        const result=await importResearchRepository({projectId:id,repo,env,flags,signal:controller.signal,authorize},operation,metadata,check?undefined:bytes);
        if(!await authorize()){json(401,{error:'authentication_required'});return;}controller.signal.throwIfAborted();json(200,result);
      }catch(error){json(timedOut?504:error.status??503,{error:timedOut?'git_timeout':error.status?error.message:'git_unavailable'});}
      finally{clearTimeout(timer);req.off('aborted',stop);req.off('error',stop);busy.delete(id);}
      return;
    }
    if(branchRoute){
      const [,id,operation]=branchRoute,write=operation!=='branches',review=req.headers['x-hub-git-review'];
      if(review!==undefined&&(typeof review!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([a-f0-9]{64}):([a-f0-9]{40}|[a-f0-9]{64}):([a-f0-9]{40}|[a-f0-9]{64})$(?![\s\S])/.test(review))){req.resume();json(400,{error:'invalid_review'});return;}
      if(req.method!==(write?'POST':'GET')){req.resume();json(405,{error:'method_not_allowed'});return;}
      const token=credential(req.headers.authorization);if(typeof token!=='string'||token.length!==43||!/^[-\w]+$/.test(token)){req.resume();json(401,{error:'authentication_required'});return;}
      if(write&&(req.headers['content-type']!=='application/json'||req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')){req.resume();json(415,{error:'unsupported_content'});return;}
      if(write&&req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>1024)){req.resume();json(413,{error:'request_too_large'});return;}
      try{if(!await readAuthorization(id,true,token,undefined,review)){req.resume();json(401,{error:'authentication_required'});return;}}catch{req.resume();json(503,{error:'authorization_unavailable'});return;}
      if(res.destroyed)return;if(busy.has(id)){req.resume();json(409,{error:'repository_busy'});return;}if(busy.size>=4){req.resume();json(503,{error:'repository_capacity'});return;}busy.add(id);
      const controller=new AbortController();let timedOut=false;const stop=()=>controller.abort(),timer=setTimeout(()=>{timedOut=true;controller.abort();req.resume();},20000);req.once('aborted',stop);req.once('error',stop);res.once('close',()=>{if(!res.writableEnded)stop();});
      try{
        const repo=path.join(root,`${id}.git`),stat=await lstat(repo).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!stat){req.resume();json(404,{error:'not_found'});return;}if(stat.isSymbolicLink()||!stat.isDirectory()||!(await realpath(repo)).startsWith(root+path.sep))throw Error('invalid_repository');
        let input;if(write){const bytes=await branchBody(req,controller.signal);try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{json(400,{error:'invalid_branch_update'});return;}}else req.resume();
        if(write&&review){const [, ,base,head]=review.split(':');if(input?.baseOid!==base||input?.headOid!==head){json(400,{error:'invalid_review'});return;}}
        const options={projectId:id,repo,env,flags,readOnly:operation==='check',signal:controller.signal,authorize:()=>readAuthorization(id,true,token,controller.signal,review)},result=write?await applyResearchBranch(options,input):await branchesResearchRepository(options);
        if(!await options.authorize()){json(401,{error:'authentication_required'});return;}controller.signal.throwIfAborted();json(200,result);
      }catch(error){json(timedOut?504:error.status??503,{error:timedOut?'git_timeout':error.status?error.message:'git_unavailable'});}finally{clearTimeout(timer);req.off('aborted',stop);busy.delete(id);}
      return;
    }
    if(browse||bundle||compare||patch){
      req.resume();const pair=compare||patch;const [,id,oid]=pair?[pair[0],pair[1],pair[3]]:browse||bundle;const baseOid=pair?.[2];
      if(req.method!=='GET'){json(405,{error:'method_not_allowed'});return;}
      try{if(!await publicRead(id)){json(404,{error:'not_found'});return;}}
      catch{json(503,{error:'authorization_unavailable'});return;}
      if(res.destroyed)return;
      if(busy.has(id)){json(409,{error:'repository_busy'});return;}
      if((bundle||patch)&&busy.size>=4){json(503,{error:'repository_capacity'});return;}busy.add(id);
      const controller=new AbortController();let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},20000),stop=()=>controller.abort();
      req.once('aborted',stop);res.once('close',()=>{if(!res.writableEnded)stop();});
      try {
        const repo=path.join(root,`${id}.git`),stat=await lstat(repo).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(!stat){json(404,{error:'not_found'});return;}
        if(stat.isSymbolicLink()||!stat.isDirectory()||!(await realpath(repo)).startsWith(root+path.sep))throw Error('invalid_repository');
        const result=await (patch?patchResearchRepository({repo,baseOid,headOid:oid,env,flags,signal:controller.signal}):bundle?bundleResearchRepository({repo,env,flags,signal:controller.signal}):browseResearchRepository({projectId:id,oid,baseOid,repo,env,flags,signal:controller.signal}));
        if(!await publicRead(id,controller.signal)){json(404,{error:'not_found'});return;}
        if(controller.signal.aborted){if(timedOut)json(504,{error:'git_timeout'});return;}
        if(patch){
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${id}-${baseOid.slice(0,12)}-${oid.slice(0,12)}.patch"`,'Content-Length':result.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Hub-Patch-SHA256':result.sha256,'X-Hub-Patch-Base':baseOid,'X-Hub-Patch-Head':oid});res.end(result.bytes);
        }else if(bundle){
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${id}.bundle"`,'Content-Length':result.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Hub-Bundle-SHA256':result.sha256});
          res.end(result.bytes);
        }else json(200,result);
      }catch(error){json(timedOut?504:error.status??503,{error:timedOut?'git_timeout':error.status?error.message:'git_unavailable'});}
      finally{clearTimeout(timer);req.off('aborted',stop);busy.delete(id);}
      return;
    }
    if(req.url?.startsWith('/v1/')){req.resume();json(404,{error:'not_found'});return;}
    const match=req.url?.match(/^\/git\/(rp_[a-f0-9]{32})\.git\/(info\/refs\?service=git-(upload|receive)-pack|git-(upload|receive)-pack)$/);
    if(!match||!idPattern.test(match[1])){req.resume();send(404,'not_found');return;}
    const [,id,tail,getKind,postKind]=match,write=(getKind??postKind)==='receive';
    if((getKind&&req.method!=='GET')||(postKind&&req.method!=='POST')){req.resume();send(405,'method_not_allowed');return;}
    if(postKind && (req.headers['content-type']!==`application/x-git-${postKind}-pack-request` || (req.headers['content-encoding']&&req.headers['content-encoding']!=='identity'))){req.resume();send(415,'unsupported_content');return;}
    const token=credential(req.headers.authorization);
    if(token===null||(token&&!/^[A-Za-z0-9_-]{43}$/.test(token))){req.resume();send(401,'authentication_required');return;}
    try {
      if(!await authorize(id,write,token)){req.resume();send(401,'authentication_required');return;}
    }catch{req.resume();send(503,'authorization_unavailable');return;}
    if(busy.has(id)){req.resume();send(409,'repository_busy');return;}busy.add(id);
    let child,timer;
    try {
      const repo=path.join(root,`${id}.git`);
      const stat=await lstat(repo).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(stat?.isSymbolicLink()||(stat&&!stat.isDirectory()))throw Error('invalid_repository');
      if(!stat)await exec('git',[...flags,'init','--bare','--initial-branch=main',`--template=${empty}`,repo],{env,windowsHide:true,timeout:10000});
      if(!((await realpath(repo)).startsWith(root+path.sep)))throw Error('invalid_repository');
      if(write&&await directorySize(repo)>200*1024*1024){req.resume();send(413,'repository_quota');return;}
      const length=req.headers['content-length'];if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_PACK)){req.resume();send(413,'request_too_large');return;}
      // Only the standard smart-HTTP endpoints are reachable. No checkout, hook,
      // shell, upload-archive, dumb object download, or arbitrary Git argument.
      child=spawn('git',[...flags,'http-backend'],{windowsHide:true,env:{...env,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:`/${id}.git/${tail.split('?')[0]}`,QUERY_STRING:getKind?`service=git-${getKind}-pack`:'',REQUEST_METHOD:req.method,CONTENT_TYPE:req.headers['content-type']??'',CONTENT_LENGTH:length??'',REMOTE_USER:write?'hub-owner':'',...(req.headers['git-protocol']==='version=2'?{GIT_PROTOCOL:'version=2'}:{})},stdio:['pipe','pipe','pipe']});
      const stop=()=>{if(child&&child.exitCode===null){if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');}};
      timer=setTimeout(()=>{stop();send(504,'git_timeout');},60000);
      let input=0,header=Buffer.alloc(0),headersDone=false;
      req.on('data',chunk=>{input+=chunk.length;if(input>MAX_PACK){stop();send(413,'request_too_large');}});
      req.on('aborted',stop);res.on('close',()=>{if(!res.writableEnded)stop();});
      child.stdin.on('error',()=>{});req.pipe(child.stdin);
      child.stderr.resume();
      await new Promise((resolve,reject)=>{
        child.on('error',reject);
        child.stdout.on('data',chunk=>{
          if(!headersDone){header=Buffer.concat([header,chunk]);const end=header.indexOf('\r\n\r\n');if(end<0){if(header.length>65536){stop();reject(Error('invalid_headers'));}return;}
            const fields=header.subarray(0,end).toString('utf8').split('\r\n');let status=200;const headers={'Cache-Control':'no-store'};
            for(const field of fields){const split=field.indexOf(':');const name=field.slice(0,split).toLowerCase(),value=field.slice(split+1).trim();if(name==='status')status=Number(value.split(' ')[0]);if(['content-type','expires','pragma'].includes(name))headers[name]=value;}
            if(!Number.isInteger(status)||status<100||status>599){stop();reject(Error('invalid_status'));return;}
            if(!res.headersSent)res.writeHead(status,headers);headersDone=true;chunk=header.subarray(end+4);header=Buffer.alloc(0);
          }
          if(!res.writableEnded&&!res.write(chunk)){child.stdout.pause();res.once('drain',()=>child.stdout.resume());}
        });
        child.on('close',code=>{if(code!==0||!headersDone){reject(Error('git_failed'));return;}if(!res.writableEnded)res.end();resolve();});
      });
    }catch{send(503,'git_unavailable');}finally{clearTimeout(timer);busy.delete(id);}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const root=process.env.HUB_RESEARCH_GIT_ROOT||fileURLToPath(new URL('../.local/research-git',import.meta.url));
  const server=await createResearchGitServer({root,authorize:hubGitAuthorizer(process.env.HUB_RESEARCH_ORIGIN||'http://127.0.0.1:3020')});
  server.listen(43131,'127.0.0.1');
}
