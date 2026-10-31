import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),OID=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const clip=(text,bytes,units=bytes)=>{let value=text.slice(0,units);if(/[\ud800-\udbff]$/.test(value))value=value.slice(0,-1);return new TextDecoder().decode(Buffer.from(value).subarray(0,bytes),{stream:true});};
export async function browseResearchRepository({projectId,oid,baseOid,repo,env,flags,signal}) {
  let subjectsTruncated=false;
  const run=async(args,maxBuffer=256*1024,bounded=false)=>{
    try {const result=await exec('git',[...flags,'--no-replace-objects','--git-dir='+repo,...args],{env:{...env,GIT_NO_LAZY_FETCH:'1'},signal,windowsHide:true,timeout:10000,maxBuffer,encoding:'buffer'});return {text:result.stdout.toString('utf8'),truncated:false};}
    catch(error){if(bounded&&error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return {text:new TextDecoder().decode(error.stdout,{stream:true}),truncated:true};throw error;}
  };
  const metadata=text=>{
    const fields=text.split('\0');if(fields.at(-1)==='')fields.pop();
    if(fields.length%4)throw fail(503,'git_unavailable');
    const commits=[];
    for(let i=0;i<fields.length;i+=4){
      const [hash,parents,timestamp,subject]=fields.slice(i,i+4),parentOids=parents?parents.split(' '):[],time=Number(timestamp)*1000;
      if(!OID.test(hash)||parentOids.length>100||parentOids.some(p=>!OID.test(p)||p.length!==hash.length)||!Number.isFinite(time)||!Number.isFinite(new Date(time).getTime()))throw fail(503,'git_unavailable');
      const committedAt=new Date(time).toISOString();if(!/^\d{4}-/.test(committedAt))throw fail(503,'git_unavailable');
      const normalized=subject.replace(/[\u0000-\u001f\u007f]/g,' '),subjectText=clip(normalized,Infinity,4096);subjectsTruncated||=subjectText.length<normalized.length;
      commits.push({oid:hash,parentOids,subject:subjectText,committedAt});
    }
    return commits;
  };
  const format='--format=%H%x00%P%x00%ct%x00%s';
  if(baseOid!==undefined&&(typeof baseOid!=='string'||![40,64].includes(baseOid.length)||!OID.test(baseOid)||typeof oid!=='string'||baseOid.length!==oid.length||!OID.test(oid)))throw fail(404,'not_found');
  if(!oid){
    if(!(await run(['for-each-ref','--count=1','--format=%(refname)','refs/heads/','refs/tags/'])).text.trim())return {projectId,commits:[]};
    const {text}=await run(['log','--no-show-signature','--no-decorate','-z',format,'--max-count=20','--date-order','--branches','--tags','--']);
    return {projectId,commits:metadata(text)};
  }
  if(!OID.test(oid))throw fail(404,'not_found');
  let reachable;
  try{reachable=await run(['for-each-ref',`--contains=${oid}`,'--count=1','--format=%(refname)','refs/heads/','refs/tags/']);}
  catch(error){if(signal?.aborted||error.killed||!Number.isInteger(error.code))throw error;throw fail(404,'not_found');}
  if(!reachable.text.trim())throw fail(404,'not_found');
  if(baseOid){
    try{if(!(await run(['for-each-ref',`--contains=${baseOid}`,'--count=1','--format=%(refname)','refs/heads/','refs/tags/'])).text.trim())throw fail(404,'not_found');}
    catch(error){if(signal?.aborted||error.killed||(!Number.isInteger(error.code)&&!error.status))throw error;throw fail(404,'not_found');}
    if(metadata((await run(['log','--no-show-signature','--no-decorate','-z',format,'--max-count=1',baseOid,'--'])).text)[0]?.oid!==baseOid)throw fail(404,'not_found');
  }
  const [commit]=metadata((await run(['log','--no-show-signature','--no-decorate','-z',format,'--max-count=1',oid,'--'])).text);
  if(!commit||commit.oid!==oid)throw fail(404,'not_found');
  const message=await run(['log','--no-show-signature','--no-decorate','--format=%B','--max-count=1',oid,'--'],65536,true);
  commit.message=clip(message.text.replace(/\n$/,''),65536);
  const comparison=baseOid?[baseOid,oid]:commit.parentOids.length?[commit.parentOids[0],oid]:[oid];
  const command=baseOid||commit.parentOids.length?['diff']:['diff-tree','--root','--no-commit-id','-r'];
  const common=['--no-ext-diff','--no-textconv','--no-color','--find-renames','--find-copies','--find-copies-harder'];
  const names=await run([...command,...common,'--name-status','-z',...comparison,'--'],65536,true);
  const parts=names.text.split('\0'),files=[];if(parts.at(-1)!=='')parts.pop();let i=0;
  while(i<parts.length-1&&files.length<100){
    const status=parts[i++],first=parts[i++];
    if(!status||first===undefined)break;
    if(/^[RC](?:100|[1-9]?[0-9])$/.test(status)){const next=parts[i++];if(next===undefined)break;files.push({path:next,status,oldPath:first});}
    else if(/^[AMDT]$/.test(status))files.push({path:first,status});
    else throw fail(503,'git_unavailable');
  }
  const patch=await run([...command,...common,'--patch',...comparison,'--'],256*1024,true);
  if(files.some(file=>!file.path||file.path.length>8192||file.path.includes('\0')||(file.oldPath!==undefined&&(file.oldPath.length>8192||file.oldPath.includes('\0')))))throw fail(503,'git_unavailable');
  const result={projectId,commit,files,diff:patch.text.includes('\0')?'':clip(patch.text,256*1024,100000),truncated:subjectsTruncated||message.truncated||Buffer.byteLength(message.text)>65536||names.truncated||patch.truncated||patch.text.length>100000||patch.text.includes('\0')||i<parts.length-1,...(baseOid?{baseOid}:{})};
  while(Buffer.byteLength(JSON.stringify(result))>512*1024){result.truncated=true;if(result.diff.length)result.diff=clip(result.diff,Infinity,Math.floor(result.diff.length/2));else if(commit.message.length)commit.message=clip(commit.message,Infinity,Math.floor(commit.message.length/2));else if(files.length)files.pop();else throw fail(503,'git_unavailable');}
  return result;
}
