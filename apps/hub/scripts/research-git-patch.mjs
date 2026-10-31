import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),oid=value=>typeof value==='string'&&[40,64].includes(value.length)&&/^[a-f0-9]+$/.test(value);
export const MAX_GIT_PATCH=16*1024*1024;
const fail=(status,message)=>Object.assign(Error(message),{status});
/** A full binary tree diff, not executable code, author metadata or commit history. */
export async function patchResearchRepository({repo,baseOid,headOid,env,flags,signal}){
 if(!oid(baseOid)||!oid(headOid)||baseOid.length!==headOid.length)throw fail(404,'not_found');
 const run=args=>exec('git',[...flags,'--no-replace-objects','--git-dir='+repo,...args],{env:{...env,GIT_NO_LAZY_FETCH:'1'},signal,windowsHide:true,timeout:10000,maxBuffer:MAX_GIT_PATCH,encoding:'buffer'});
 for(const value of new Set([baseOid,headOid])){
  try{const type=(await run(['cat-file','-t',value])).stdout.toString().trim(),refs=(await run(['for-each-ref',`--contains=${value}`,'--count=1','--format=%(refname)','refs/heads/','refs/tags/'])).stdout.toString().trim();if(type!=='commit'||!refs)throw fail(404,'not_found');}
  catch(error){if(error.status||signal?.aborted||error.killed||!Number.isInteger(error.code))throw error;throw fail(404,'not_found');}
 }
 try{const {stdout}=await run(['diff','--binary','--full-index','--no-ext-diff','--no-textconv','--no-color','--no-renames','--ignore-submodules=none','--src-prefix=a/','--dst-prefix=b/',baseOid,headOid,'--']);if(!stdout.length)throw fail(409,'no_changes');return {bytes:stdout,sha256:createHash('sha256').update(stdout).digest('hex')};}
 catch(error){if(error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')throw fail(413,'patch_too_large');throw error;}
}
