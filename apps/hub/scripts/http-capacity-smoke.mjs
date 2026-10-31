const origin=process.env.HUB_SMOKE_ORIGIN||"http://127.0.0.1:3020";
const paths=["/api/health","/search","/notifications","/hubpedia"];
const concurrency=Math.max(1,Math.min(20,Number(process.env.HUB_SMOKE_CONCURRENCY||8)));
const total=Math.max(concurrency,Math.min(500,Number(process.env.HUB_SMOKE_REQUESTS||80)));
const started=Date.now();let next=0;const results=[];
async function worker(){while(next<total){const index=next++;const path=paths[index%paths.length];const at=Date.now();try{const response=await fetch(origin+path,{redirect:"manual",signal:AbortSignal.timeout(10000)});results.push({path,status:response.status,ms:Date.now()-at});}catch{results.push({path,status:0,ms:Date.now()-at});}}}
await Promise.all(Array.from({length:concurrency},worker));
const failures=results.filter(x=>x.status===0||x.status>=500);const sorted=results.map(x=>x.ms).sort((a,b)=>a-b);
const byStatus=Object.fromEntries([...new Set(results.map(x=>x.status))].map(status=>[status,results.filter(x=>x.status===status).length]));
const byPath=Object.fromEntries(paths.map(path=>[path,{total:results.filter(x=>x.path===path).length,failures:failures.filter(x=>x.path===path).length}]));
console.log(JSON.stringify({total,concurrency,failures:failures.length,byStatus,byPath,p95Ms:sorted[Math.floor(sorted.length*.95)]??0,elapsedMs:Date.now()-started},null,2));if(failures.length)process.exitCode=1;
