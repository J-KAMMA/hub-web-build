// Actual bundled markup/styles/modules; synthetic account/IPC, no real login or native keys.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const ui=new URL('../../hub-desktop/ui/',import.meta.url);
const allowed=new Set(['index.html','styles.css','hub-network.mjs','hub-network-sync.mjs','hub-peer-catalog.mjs','hub-read-recovery.mjs']);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!allowed.has(path)){res.writeHead(404);res.end();return;}
  const body=await readFile(new URL(path,ui),'utf8');
  res.setHeader('Content-Type',path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(path==='index.html'?body.replace('<script type="module" src="./app.js"></script>',''):body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async()=>{
    const {createHubNetwork}=await import('/hub-network.mjs');
    document.querySelectorAll('.view.on').forEach(el=>el.classList.remove('on'));
    const view=document.querySelector('#view-node');view.classList.add('on');
    view.replaceChildren(Object.assign(document.createElement('div'),{className:'view-head',textContent:'分散ネットワーク'}));
    const fixture=window.fixture={account:null,sources:['https://web.example'],offline:false,calls:[]};
    localStorage.setItem('hub.network.sources.v1',JSON.stringify(['https://legacy.example']));
    window.network=createHubNetwork({document,storage:localStorage,getAccount:()=>fixture.account,changed:kind=>{if(fixture.exerciseReads)void network.load(kind);},manage:()=>{},openWeb:()=>{},invoke:async(name,args)=>{
      if(name==='hub_origin')return 'https://main.example';
      if(name==='hub_post_peer_control'){
        if(args.input.action==='identity')return {profileId:'synthetic-profile'};
        if(args.input.action==='register')return {id:'ffffffff-ffff-4fff-8fff-ffffffffffff'};
        if(args.input.action==='poll')return {peers:[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',label:'Hub Desktop'},{id:'00000000-0000-4000-8000-000000000001',label:'Hubスマホ <img src=x>'}],signals:[]};
        return {ok:true};
      }
      if(name==='hub_network_read'){if(fixture.catalogOffline)throw 'network_unavailable';return {protocol:'hub.catalog.v1',kind:args.kind,items:[]};}
      fixture.calls.push(args);if(fixture.offline)throw 'network_unavailable';
      if(args.action==='add')fixture.sources=[...new Set([...fixture.sources,args.origin])];
      if(args.action==='remove')fixture.sources=fixture.sources.filter(s=>s!==args.origin);
      return {sources:[...fixture.sources]};
    }});await window.network.ready;
  });
  const manager=page.locator('#hub-network-manager'),rows=manager.locator('.hub-network-source');
  await page.locator('#public-post-peers').getByText('この端末のログイン状態を確認しています…',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>fixture.calls.length),0);
  await page.evaluate(()=>{fixture.account={state:'registered',deviceId:'synthetic-device'};window.dispatchEvent(new Event('hub-account-changed'));});
  await page.locator('#public-post-peers').getByText('端末間共有は停止中です。',{exact:true}).waitFor();
  assert.equal(await rows.count(),1);
  const peerPanel=page.locator('#public-post-peers');
  await peerPanel.getByRole('button',{name:'この端末の公開投稿共有を許可',exact:true}).click();
  await peerPanel.locator('summary').filter({hasText:'端末の接続状況'}).click();
  await peerPanel.getByText('Hubスマホ <img src=x>',{exact:false}).waitFor();assert.equal(await peerPanel.locator('img').count(),0);
  await peerPanel.getByText('待機中',{exact:true}).waitFor();
  await page.evaluate(()=>network.load('post'));
  await peerPanel.getByText('直近の取得: web.example · 配信元Hubから取得',{exact:true}).waitFor();
  assert.equal(await page.locator('#view-feed .hub-peer-status summary').textContent(),'直近の取得: web.example · 配信元Hubから取得');
  if(process.env.HUB_PEER_SCREENSHOT)await peerPanel.screenshot({path:process.env.HUB_PEER_SCREENSHOT});
  await peerPanel.getByRole('button',{name:'この端末の共有を停止',exact:true}).click();
  await peerPanel.getByText('公開投稿の取得はまだありません。',{exact:true}).waitFor();assert.equal(await peerPanel.getByText('Hubスマホ <img src=x>',{exact:false}).count(),0);
  await manager.getByRole('button',{name:'この端末の接続先を引き継ぐ'}).click();
  await rows.filter({hasText:'legacy.example'}).waitFor();
  await manager.getByLabel('接続するHubのURL').fill('https://desktop.example');
  await manager.getByRole('button',{name:'追加',exact:true}).click();await rows.filter({hasText:'desktop.example'}).waitFor();
  await page.evaluate(()=>{fixture.sources=['https://web.example'];window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>document.querySelectorAll('.hub-network-source').length===1);
  await page.evaluate(()=>{fixture.offline=true;window.dispatchEvent(new Event('focus'));});
  await manager.getByText(/自動で再取得します/).waitFor();
  assert.equal(await rows.count(),1);assert.equal(await manager.getByRole('button',{name:'接続を外す'}).isDisabled(),true);
  const screenshot=process.env.HUB_NETWORK_SCREENSHOT;
  if(screenshot)await manager.screenshot({path:screenshot});
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await manager.evaluate(el=>el.scrollWidth>el.clientWidth+1||el.getBoundingClientRect().right>innerWidth+1),false,`manager overflow at ${width}`);
  }
  await page.evaluate(()=>{fixture.offline=false;});
  await manager.getByText('同じHubプロフィールのWeb・デスクトップで共有しています。',{exact:true}).waitFor();
  assert.equal(await manager.getByRole('button',{name:'接続を外す'}).isEnabled(),true);
  for(const kind of ['post','product']){
    await page.evaluate(async kind=>{
      fixture.exerciseReads=true;fixture.catalogOffline=true;
      document.querySelectorAll('.view.on').forEach(el=>el.classList.remove('on'));
      document.querySelector(`[data-hub-retry="${kind}"]`).closest('.view').classList.add('on');
      await network.load(kind);
    },kind);
    const retry=page.locator(`[data-hub-retry="${kind}"]`),bar=retry.locator('xpath=ancestor::section[contains(@class,"hub-network-bar")]');
    await bar.getByText(/追加Hubの内容を取得できませんでした/).waitFor();
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:900});
      assert.equal(await bar.evaluate(el=>el.scrollWidth>el.clientWidth+1||el.getBoundingClientRect().right>innerWidth+1),false,`retry overflow: ${kind}/${width}`);
    }
    if(kind==='post'&&process.env.HUB_RETRY_SCREENSHOT)await bar.screenshot({path:process.env.HUB_RETRY_SCREENSHOT});
    await page.evaluate(()=>{fixture.catalogOffline=false;});await retry.click();
    await bar.getByText('1 Hubから取得 · 各Hub最大30件',{exact:true}).waitFor();assert.equal(await retry.isVisible(),false);
  }
  await page.evaluate(()=>{fixture.exerciseReads=false;document.querySelectorAll('.view.on').forEach(el=>el.classList.remove('on'));document.querySelector('#view-node').classList.add('on');});
  await page.evaluate(()=>{fixture.offline=true;window.dispatchEvent(new Event('focus'));});
  await manager.getByText(/自動で再取得します/).waitFor();
  const sourceCalls=await page.evaluate(()=>fixture.calls.length);
  await manager.getByLabel('接続先の管理方法').selectOption('device');
  await manager.getByText(/標準Hubやログインに依存せず/).waitFor();
  assert.equal(await rows.count(),0);
  await manager.getByLabel('接続するHubのURL').fill('https://independent.example');
  await manager.getByRole('button',{name:'追加',exact:true}).click();
  await rows.filter({hasText:'independent.example'}).waitFor();
  await page.evaluate(()=>network.load('post'));
  assert.equal(await page.evaluate(()=>fixture.calls.length),sourceCalls);
  assert.deepEqual(await page.evaluate(()=>fixture.sources),['https://web.example']);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await manager.evaluate(el=>el.scrollWidth>el.clientWidth+1||el.getBoundingClientRect().right>innerWidth+1),false,`device manager overflow at ${width}`);
  }
  if(process.env.HUB_DEVICE_NETWORK_SCREENSHOT)await manager.screenshot({path:process.env.HUB_DEVICE_NETWORK_SCREENSHOT});
  await rows.getByRole('button',{name:'接続を外す'}).click();
  assert.equal(await rows.count(),0);
  await page.evaluate(()=>{fixture.offline=false;});
  await manager.getByLabel('接続先の管理方法').selectOption('profile');
  await manager.getByText('同じHubプロフィールのWeb・デスクトップで共有しています。',{exact:true}).waitFor();
  assert.equal(await rows.count(),1);
  await page.evaluate(()=>{fixture.account={state:'signed_out'};window.dispatchEvent(new Event('hub-account-changed'));});
  await manager.getByText(/この端末に保存しています/).waitFor();assert.equal(await rows.count(),0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({markup:fileURLToPath(new URL('index.html',ui)),authentication:'synthetic IPC',migration:true,add:true,webRemoval:true,offlineCache:true,deviceManagementWithoutPrimary:true,separateSourceLists:true,logoutClears:true,inPlaceReadRetry:['post','product'],widths:[1280,390],pageErrors:errors.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
