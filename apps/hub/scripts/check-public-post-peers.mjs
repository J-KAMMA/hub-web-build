// Two independent browsers, synthetic account discovery, real WebRTC. No real login or consent is changed.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {postManifest} from '../lib/hub-peer-catalog.mjs';
const moduleText=await readFile(new URL('../lib/hub-peer-catalog.mjs',import.meta.url),'utf8');
const peers=new Map(),signals=new Map(),revoked=new Set(),offline=new Set(),browsers=[],pages=[],errors=[];
let fullReads=0,encryptedSignals=0,base;
let catalog={protocol:'hub.catalog.v1',kind:'post',items:Array.from({length:8},(_,i)=>({id:`post-${i}`,title:`公開投稿 ${i}`,summary:'日本語😀'.repeat(800),path:`/v2/posts/post-${i}`,updatedAt:'2026-10-01'}))};
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/module.mjs'){res.setHeader('Content-Type','text/javascript');res.end(moduleText);return;}
    if(req.url?.startsWith('/?client=')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<script type="module">
      import {createPeerCatalog} from '/module.mjs';
      const send=RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send=function(data){if(window.tamper){const m=JSON.parse(data);if(m.type==='chunk'){m.text=m.text.replace('post-','lost-');data=JSON.stringify(m);window.tampered=(window.tampered||0)+1;}}return send.call(this,data);};
      const client=new URL(location.href).searchParams.get('client');
      window.runtime=createPeerCatalog({base:location.origin,storage:localStorage,label:'端末 '+client,iceServers:[],
        control:async body=>{const r=await fetch('/control',{method:'POST',headers:{'x-test-client':client},body:JSON.stringify(body)});if(!r.ok)throw Error(r.status===401?'account_required':'network_unavailable');return r.json();},
        readCatalog:async origin=>(await fetch(origin+'/catalog')).json(),
        readManifest:async origin=>(await fetch(origin+'/manifest')).json()});
      await runtime.refresh();window.ready=true;
      </script>`);return;}
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.url==='/catalog'){fullReads++;res.end(JSON.stringify(catalog));return;}
    if(req.url==='/manifest'){res.end(JSON.stringify(await postManifest(base,catalog)));return;}
    if(req.url!=='/control'){res.statusCode=404;res.end('{}');return;}
    const client=req.headers['x-test-client'];if(revoked.has(client)){res.statusCode=401;res.end('{}');return;}
    if(offline.has(client)){res.statusCode=503;res.end('{}');return;}
    const parts=[];for await(const chunk of req)parts.push(chunk);const input=JSON.parse(Buffer.concat(parts)),own=peers.get(input.deviceId);let result={ok:true};
    if(input.action==='identity')result={profileId:'test-profile'};
    else if(input.action==='register'){assert.equal(input.consent,true);assert.equal(input.scope,'public-posts-v1');const id=randomUUID();peers.set(id,{id,client,label:input.label,publicKey:input.publicKey,lastSeen:Date.now()});result={id};}
    else{
      assert.equal(own?.client,client);
      if(input.action==='poll'){own.lastSeen=Date.now();result={peers:[...peers.values()].filter(p=>!revoked.has(p.client)&&p.lastSeen>Date.now()-30000).map(({id,label,publicKey})=>({id,label,publicKey})),signals:[...signals.values()].filter(s=>s.toPeer===input.deviceId)};}
      else if(input.action==='signal'){assert(!input.ciphertext.includes('v=0'));encryptedSignals++;signals.set(input.id,{...input,fromPeer:input.deviceId});}
      else if(input.action==='ack')for(const id of input.ids)signals.delete(id);
      else if(input.action==='remove'){peers.delete(input.deviceId);for(const [id,s]of signals)if(s.fromPeer===input.deviceId||s.toPeer===input.deviceId)signals.delete(id);}
      else throw Error('unknown action');
    }
    res.end(JSON.stringify(result));
  }catch(error){errors.push(error.message);res.statusCode=500;res.end('{}');}
});
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  for(let i=0;i<2;i++){const browser=await chromium.launch({headless:true});browsers.push(browser);const page=await browser.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.goto(`${base}/?client=${i}`);await page.waitForFunction(()=>window.ready);}
  assert.equal(peers.size,0,'no registration before explicit opt-in');
  await Promise.all(pages.map(page=>page.evaluate(()=>runtime.setEnabled(true))));
  await Promise.all(pages.map(page=>page.waitForFunction(()=>runtime.state.connected===1,{},{timeout:30000})));
  assert.equal(peers.size,2);assert(encryptedSignals>=2);
  const devices=await pages[1].evaluate(()=>runtime.state.peers);assert.equal(devices.length,1);assert.equal(devices[0].label,'端末 0');assert.equal(devices[0].status,'connected');assert.equal('publicKey' in devices[0],false);
  const first=await pages[0].evaluate(origin=>runtime.read(origin),base);assert.deepEqual(first,catalog);const afterFirst=fullReads;
  assert.deepEqual(await pages[0].evaluate(()=>runtime.state.lastRead),{origin:base,via:'publisher'});
  const second=await pages[1].evaluate(origin=>runtime.read(origin),base);assert.deepEqual(second,catalog);assert.equal(fullReads,afterFirst,'peer transfer must avoid another full catalog HTTP request');assert.equal(await pages[1].evaluate(()=>runtime.state.viaPeer),1);
  assert.deepEqual(await pages[1].evaluate(()=>runtime.state.lastRead),{origin:base,via:'peer',peerLabel:'端末 0'});
  await pages[0].evaluate(()=>window.tamper=true);
  assert.deepEqual(await pages[1].evaluate(origin=>runtime.read(origin),base),catalog);assert(await pages[0].evaluate(()=>window.tampered)>0,'tamper fixture must modify frames');assert.equal(fullReads,afterFirst+1,'tampered peer content must fall back');assert.equal(await pages[1].evaluate(()=>runtime.state.viaPeer),1);
  assert.deepEqual(await pages[1].evaluate(()=>runtime.state.lastRead),{origin:base,via:'publisher'});
  await pages[0].evaluate(()=>window.tamper=false);
  catalog={...catalog,items:[{...catalog.items[0],title:'更新済み',summary:'削除した投稿を含まない現在の内容'}]};
  assert.deepEqual(await pages[1].evaluate(origin=>runtime.read(origin),base),catalog);assert.equal(fullReads,afterFirst+2,'stale caches must fall back to the current publisher');
  await pages[0].evaluate(()=>runtime.setEnabled(false));
  assert.deepEqual(await pages[0].evaluate(()=>({peers:runtime.state.peers,lastRead:runtime.state.lastRead})),{peers:[],lastRead:null});
  await pages[1].waitForFunction(()=>runtime.state.connected===0,{},{timeout:12000});
  assert.deepEqual(await pages[1].evaluate(origin=>runtime.read(origin),base),catalog);assert.equal(fullReads,afterFirst+3,'stopped peers must fall back');
  await pages[0].evaluate(()=>runtime.setEnabled(true));await Promise.all(pages.map(page=>page.waitForFunction(()=>runtime.state.connected===1,{},{timeout:30000})));
  revoked.add('0');await pages[0].waitForFunction(()=>runtime.state.status==='unavailable'&&runtime.state.connected===0,{},{timeout:12000});await pages[1].waitForFunction(()=>runtime.state.connected===0,{},{timeout:12000});
  assert.deepEqual(await pages[1].evaluate(origin=>runtime.read(origin),base),catalog);assert.equal(fullReads,afterFirst+4);
  // An authentication failure must not silently resume after the server accepts requests again.
  const registrations=peers.size;revoked.delete('0');await pages[0].waitForTimeout(2500);assert.equal(peers.size,registrations);assert.equal(await pages[0].evaluate(()=>runtime.state.status),'unavailable');
  await pages[0].evaluate(()=>runtime.refresh());await Promise.all(pages.map(page=>page.waitForFunction(()=>runtime.state.connected>=1,{},{timeout:40000})));
  offline.add('0');await pages[0].waitForFunction(()=>runtime.state.status==='reconnecting',{},{timeout:12000});
  const beforeOfflineRead=fullReads;assert.deepEqual(await pages[0].evaluate(origin=>runtime.read(origin),base),catalog);assert.equal(fullReads,beforeOfflineRead+1);
  offline.delete('0');await Promise.all(pages.map(page=>page.waitForFunction(()=>runtime.state.connected>=1,{},{timeout:45000})));
  await pages[0].evaluate(origin=>runtime.read(origin),base);const beforeRecoveredRead=fullReads;
  assert.deepEqual(await pages[1].evaluate(origin=>runtime.read(origin),base),catalog);assert.equal(fullReads,beforeRecoveredRead,'recovered connection must transfer via WebRTC again');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,realWebRTC:true,independentBrowsers:2,initialPosts:8,encryptedSignals,fullReads,checks:['explicit opt-in','exact multichunk UTF-8 content','peer hit without full HTTP body','tamper fallback','withdrawal fallback','stop fallback','revocation disconnect without auto-resume','automatic network recovery','WebRTC transfer after recovery']}));
}finally{await Promise.allSettled(pages.map(page=>page.evaluate(()=>runtime.dispose())));await Promise.allSettled(browsers.map(browser=>browser.close()));await new Promise(r=>server.close(r));}
