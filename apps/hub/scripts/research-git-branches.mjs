import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),oid=v=>typeof v==='string'&&[40,64].includes(v.length)&&/^[a-f0-9]+$/.test(v);
const fail=(status,message)=>Object.assign(Error(message),{status});
const branch=v=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=200&&!/[\x00-\x20\x7f\\]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(v);
function runner({repo,env,flags,signal}){return args=>exec('git',[...flags,'--no-replace-objects','--git-dir='+repo,...args],{env:{...env,GIT_NO_LAZY_FETCH:'1'},signal,windowsHide:true,timeout:10000,maxBuffer:65536,encoding:'buffer'});}
export function researchBranchInput(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||!Object.keys(value).every(key=>['branch','baseOid','headOid'].includes(key))||!branch(value.branch)||!oid(value.baseOid)||!oid(value.headOid)||value.baseOid.length!==value.headOid.length||value.baseOid===value.headOid)throw fail(400,'invalid_branch_update');return value;}
export async function branchesResearchRepository(options){
 const run=runner(options),raw=(await run(['for-each-ref','--count=101','--sort=refname','--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)','refs/heads/'])).stdout;
 const lines=new TextDecoder('utf-8',{fatal:true}).decode(raw).split('\n').filter(Boolean);if(lines.length>100)throw fail(413,'too_many_branches');
 const branches=lines.map(line=>{const [ref,hash,type,symref,...extra]=line.split('\0'),name=ref.slice(11);if(extra.length||!ref.startsWith('refs/heads/')||!branch(name)||!oid(hash)||type!=='commit'||symref)throw fail(409,'unsupported_branch');return {branch:name,oid:hash};});
 return {projectId:options.projectId,branches};
}
/** The outcome proves current inclusion, not who previously moved the branch. */
export async function applyResearchBranch(options,input){
 const {branch:name,baseOid,headOid}=researchBranchInput(input),ref='refs/heads/'+name,run=runner(options);
 const integerFailure=error=>!options.signal?.aborted&&!error.killed&&Number.isInteger(error.code);
 try{await run(['check-ref-format',ref]);}catch(error){if(integerFailure(error))throw fail(400,'invalid_branch_update');throw error;}
 try{await run(['symbolic-ref','-q',ref]);throw fail(409,'symbolic_branch');}catch(error){if(error.status)throw error;if(!integerFailure(error)||error.code!==1)throw error;}
 const current=async()=>{try{const value=(await run(['show-ref','--verify','--hash',ref])).stdout.toString().trim();if(!oid(value)||value.length!==headOid.length||(await run(['cat-file','-t',value])).stdout.toString().trim()!=='commit')throw fail(409,'unsupported_branch');return value;}catch(error){if(integerFailure(error))throw fail(404,'branch_not_found');throw error;}};
 for(const value of [baseOid,headOid]){try{const type=(await run(['cat-file','-t',value])).stdout.toString().trim(),refs=(await run(['for-each-ref',`--contains=${value}`,'--count=1','--format=%(refname)','refs/heads/','refs/tags/'])).stdout.toString().trim();if(type!=='commit'||!refs)throw fail(404,'not_found');}catch(error){if(integerFailure(error))throw fail(404,'not_found');throw error;}}
 const includes=async(a,b)=>{try{await run(['merge-base','--is-ancestor',a,b]);return true;}catch(error){if(integerFailure(error)&&error.code===1)return false;throw error;}};
 if(!await includes(baseOid,headOid))throw fail(409,'not_fast_forward');
 let tip=await current();const already=await includes(headOid,tip);
 if(!options.readOnly&&!already&&tip!==baseOid)throw fail(409,'branch_changed');
 if(!await options.authorize())throw fail(401,'authentication_required');options.signal?.throwIfAborted();
 if(options.readOnly){tip=await current();return {projectId:options.projectId,branch:name,baseOid,headOid,currentOid:tip,outcome:await includes(headOid,tip)?'already_included':'not_included'};}
 if(!already){try{await run(['update-ref','--no-deref',ref,headOid,baseOid]);}catch(error){if(integerFailure(error))throw fail(409,'branch_changed');throw error;}}
 tip=await current();if(!await includes(headOid,tip))throw fail(409,'branch_changed');
 return {projectId:options.projectId,branch:name,baseOid,headOid,currentOid:tip,outcome:already?'already_included':'updated'};
}
