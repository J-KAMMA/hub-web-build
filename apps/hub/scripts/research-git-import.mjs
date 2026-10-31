import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readdir,lstat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {researchBranchInput} from './research-git-branches.mjs';

const exec=promisify(execFile),MAX_BYTES=50*1024*1024,MAX_REPO=200*1024*1024;
const fail=(status,message)=>Object.assign(Error(message),{status});
export function researchImportInput(value){
  const keys=['requestId','branch','baseOid','headOid','bundleSha256'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==5||Object.keys(value).some(key=>!keys.includes(key))||typeof value.requestId!=='string'||value.requestId.length!==36||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$(?![\s\S])/.test(value.requestId)||typeof value.bundleSha256!=='string'||value.bundleSha256.length!==64||!/^([a-f0-9]{64})$(?![\s\S])/.test(value.bundleSha256)||/[\u0080-\u009f]/u.test(value.branch))throw fail(400,'invalid_import');
  try{researchBranchInput({branch:value.branch,baseOid:value.baseOid,headOid:value.headOid});}catch{throw fail(400,'invalid_import');}
  if(value.branch==='@'||value.branch.endsWith('.')||/\.\.|@\{|[~^:?*\[]/.test(value.branch)||value.branch.split('/').some(part=>!part||part.startsWith('.')||part.endsWith('.lock')))throw fail(400,'invalid_import');
  return value;
}
export function researchImportHeader(header){
  if(typeof header!=='string'||header.length>2048||!/^[-A-Za-z0-9_]+$(?![\s\S])/.test(header))throw fail(400,'invalid_import');
  const bytes=Buffer.from(header,'base64url');
  if(bytes.length>1024||bytes.toString('base64url')!==header)throw fail(400,'invalid_import');
  try{return researchImportInput(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{throw fail(400,'invalid_import');}
}
async function size(dir){
  let total=0;for(const entry of await readdir(dir,{withFileTypes:true})){const name=path.join(dir,entry.name);if(entry.isSymbolicLink())throw fail(409,'invalid_repository');total+=entry.isDirectory()?await size(name):(await lstat(name)).size;if(total>MAX_REPO)throw fail(413,'repository_quota');}return total;
}
function runner(options,repo=options.repo){return args=>exec('git',[...options.flags,'-c','fetch.fsckObjects=true','-c','transfer.fsckObjects=true','-c','gc.auto=0','--no-replace-objects','--git-dir='+repo,...args],{env:{...options.env,GIT_NO_LAZY_FETCH:'1'},signal:options.signal,windowsHide:true,timeout:10000,maxBuffer:65536,encoding:'buffer'});}
async function permitted(options){if(!await options.authorize())throw fail(401,'authentication_required');options.signal?.throwIfAborted();}
async function tip(run,ref){
  try{await run(['symbolic-ref','-q',ref]);throw fail(409,'symbolic_branch');}catch(error){if(error.status)throw error;if(error.code!==1||error.killed)throw error;}
  try{await run(['show-ref','--verify','--quiet',ref]);}catch(error){if(error.code===1&&!error.killed)return null;throw error;}
  return (await run(['show-ref','--verify','--hash',ref])).stdout.toString().trim();
}
function header(bytes){
  const end=bytes.indexOf(Buffer.from('\n\n'));if(end<0||end>65536)throw fail(400,'invalid_bundle');
  let lines;try{lines=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,end)).split('\n');}catch{throw fail(400,'invalid_bundle');}
  if(lines.shift()!=='# v3 git bundle')throw fail(400,'invalid_bundle');
  let format='sha1';const refs=[];
  for(const line of lines){if(line.startsWith('-'))throw fail(400,'bundle_prerequisites');if(line.startsWith('@')){if(line==='@object-format=sha256')format='sha256';else if(line!=='@object-format=sha1')throw fail(400,'invalid_bundle');continue;}
    const match=line.match(/^([a-f0-9]{40}|[a-f0-9]{64}) (refs\/(?:heads|tags)\/.+)$(?![\s\S])/);if(match)refs.push({oid:match[1],ref:match[2]});else if(!/^([a-f0-9]{40}|[a-f0-9]{64}) (?:HEAD|refs\/[^\x00-\x20\x7f]+)$(?![\s\S])/.test(line))throw fail(400,'invalid_bundle');
  }
  if(!refs.length||refs.length>100)throw fail(400,'invalid_bundle');return {format,refs};
}
/** Import objects without a checkout; the only permanent ref is a new candidate. */
export async function importResearchRepository(options,operation,metadata,bytes){
  const input=researchImportInput(metadata),{requestId,branch,baseOid,headOid,bundleSha256}=input;
  if(!['preview','save','check'].includes(operation))throw fail(400,'invalid_import');
  const candidateBranch='hub-import/'+requestId,candidateRef='refs/heads/'+candidateBranch,targetRef='refs/heads/'+branch,run=runner(options);
  try{await run(['check-ref-format',targetRef]);}catch(error){if(Number.isInteger(error.code)&&!error.killed)throw fail(400,'invalid_import');throw error;}
  if((await run(['rev-parse','--is-bare-repository'])).stdout.toString().trim()!=='true')throw fail(409,'invalid_repository');
  const objectFormat=(await run(['rev-parse','--show-object-format'])).stdout.toString().trim();if(objectFormat!==(baseOid.length===40?'sha1':'sha256'))throw fail(409,'object_format_mismatch');
  const current=await tip(run,candidateRef);
  if(current!==null&&current!==headOid)throw fail(409,'candidate_changed');
  if(operation==='check'){await permitted(options);return {projectId:options.projectId,requestId,branch,baseOid,headOid,candidateBranch,currentOid:current,outcome:current?'imported':'not_imported'};}
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw fail(400,'invalid_bundle');if(bytes.length>MAX_BYTES)throw fail(413,'request_too_large');
  if(createHash('sha256').update(bytes).digest('hex')!==bundleSha256)throw fail(400,'bundle_hash_mismatch');
  const {format,refs}=header(bytes);if(format!==objectFormat)throw fail(409,'object_format_mismatch');
  const prefix=path.join(await realpath(tmpdir()),'hub-git-import-'),temp=await mkdtemp(prefix);
  try{
    const file=path.join(temp,'input.bundle'),scratch=path.join(temp,'objects.git'),empty=path.join(temp,'empty');await mkdir(empty);await writeFile(file,bytes);
    await exec('git',[...options.flags,'init','--bare','--object-format='+format,'--template='+empty,scratch],{env:options.env,signal:options.signal,windowsHide:true,timeout:10000});
    const isolated=runner(options,scratch);
    await isolated(['bundle','verify',file]);await isolated(['bundle','unbundle',file]);await size(scratch);
    // Only advertised public heads/tags establish reachability. Ignore HEAD and custom refs.
    for(const {ref,oid} of refs){await isolated(['check-ref-format',ref]);await isolated(['update-ref','--no-deref',ref,oid]);}
    await isolated(['fsck','--strict','--no-reflogs']);
    for(const oid of [baseOid,headOid]){
      if((await isolated(['cat-file','-t',oid])).stdout.toString().trim()!=='commit'||!(await isolated(['for-each-ref','--count=1','--contains='+oid,'--format=%(refname)','refs/heads/','refs/tags/'])).stdout.length)throw fail(400,'unpublished_commit');
    }
    try{await isolated(['merge-base','--is-ancestor',baseOid,headOid]);}catch(error){if(error.code===1&&!error.killed)throw fail(409,'not_fast_forward');throw error;}
    const baseTreeOid=(await isolated(['rev-parse',baseOid+'^{tree}'])).stdout.toString().trim(),headTreeOid=(await isolated(['rev-parse',headOid+'^{tree}'])).stdout.toString().trim();
    await permitted(options);
    const result={projectId:options.projectId,...input,bundleBytes:bytes.length,baseTreeOid,headTreeOid,objectFormat,candidateBranch};
    if(operation==='preview'){if(await tip(run,targetRef)!==baseOid)throw fail(409,'branch_changed');return {...result,outcome:'preview'};}
    if(await tip(run,candidateRef)===headOid)return {...result,outcome:'already_imported'};
    if(await tip(run,targetRef)!==baseOid)throw fail(409,'branch_changed');
    if((await run(['for-each-ref','--count=100','--format=%(refname)','refs/heads/'])).stdout.toString().split('\n').filter(Boolean).length>=100)throw fail(413,'too_many_branches');
    if(await size(options.repo)+await size(scratch)>MAX_REPO)throw fail(413,'repository_quota');
    // No destination refspec and no FETCH_HEAD: copy only the selected commit's objects.
    await run(['fetch','--no-tags','--no-write-fetch-head',scratch,headOid]);await size(options.repo);await permitted(options);
    // Verify the original branch and create the candidate in one ref transaction.
    await new Promise((resolve,reject)=>{
      const child=execFile('git',[...options.flags,'--no-replace-objects','--git-dir='+options.repo,'update-ref','--no-deref','--stdin'],{env:{...options.env,GIT_NO_LAZY_FETCH:'1'},signal:options.signal,windowsHide:true,timeout:10000,maxBuffer:65536},(error,stdout)=>error?reject(error):resolve(stdout));
      child.stdin.on('error',()=>{});child.stdin.end(`verify ${targetRef} ${baseOid}\ncreate ${candidateRef} ${headOid}\n`);
    }).catch(error=>{if(Number.isInteger(error.code)&&!error.killed)throw fail(409,'branch_changed');throw error;});
    if(await tip(run,candidateRef)!==headOid)throw fail(409,'candidate_changed');return {...result,outcome:'imported'};
  }catch(error){if(error.status||options.signal?.aborted||error.killed||!Number.isInteger(error.code))throw error;throw fail(400,'invalid_bundle');}
  finally{const absolute=path.resolve(temp);if(!absolute.startsWith(prefix)||path.dirname(absolute)!==path.dirname(prefix))throw Error('invalid_cleanup_path');await rm(absolute,{recursive:true,force:true});}
}
