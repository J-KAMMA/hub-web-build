// Real local settings UI with synthetic account/discovery responses. Does not enable sharing for a real profile.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1100,height:900}}),page=await context.newPage(),peers=new Map(),actions=[],errors=[];
  // Freeze this test's loaded UI while other workspace edits trigger dev-server refreshes.
  await context.routeWebSocket('**/_next/webpack-hmr*',()=>{});
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().route('**/api/network/sources',route=>route.fulfill({contentType:'application/json',body:'{"sources":[]}'}));
  await page.context().route('**/api/network/peers',async route=>{
    const input=route.request().postDataJSON();actions.push(input.action);let result={ok:true};
    if(input.action==='identity')result={profileId:'synthetic-ui-profile'};
    else if(input.action==='register'){assert.equal(input.consent,true);assert.equal(input.scope,'public-posts-v1');const id='1'+crypto.randomUUID().slice(1);peers.set(id,{id,publicKey:input.publicKey});result={id};}
    else if(input.action==='poll')result={peers:[peers.get(input.deviceId),{id:'00000000-0000-4000-8000-000000000001',label:'Hubスマホ <img src=x>'}],signals:[]};
    else if(input.action==='remove')peers.delete(input.deviceId);
    else throw Error('Unexpected UI action');
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:3020/v2/settings#hub-connections',{waitUntil:'domcontentloaded',timeout:60000});
  const panel=page.locator('#public-post-peers');await panel.getByText('端末間共有は停止中です。',{exact:true}).waitFor();
  assert.equal(peers.size,0);assert(!actions.includes('register'));
  await panel.getByRole('button',{name:'この端末の公開投稿共有を許可',exact:true}).click();
  await panel.getByText('0台に接続 · 端末からの取得 0回',{exact:true}).waitFor();
  assert.equal(peers.size,1);
  await panel.locator('summary').filter({hasText:'端末の接続状況'}).click();
  await panel.getByText('Hubスマホ <img src=x>',{exact:false}).waitFor();assert.equal(await panel.locator('img').count(),0);
  await panel.getByText('待機中',{exact:true}).waitFor();
  const second=await page.context().newPage();second.on('pageerror',e=>errors.push(e.message));
  const registered=second.waitForResponse(r=>r.url().endsWith('/api/network/peers')&&r.request().postDataJSON()?.action==='poll',{timeout:60000}).then(()=>true,()=>false);
  const navigation=await second.goto('http://127.0.0.1:3020/v2/settings#hub-connections',{waitUntil:'domcontentloaded',timeout:60000});
  if(!await registered)throw Error(JSON.stringify({phase:'second tab registration',status:navigation?.status(),panel:await second.locator('#public-post-peers').textContent().catch(()=>null),actions,peers:peers.size,errors}));
  await second.locator('#public-post-peers').getByText('0台に接続 · 端末からの取得 0回',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'この端末の共有を停止',exact:true}).waitFor({timeout:60000});
  await second.evaluate(()=>{window.peerStopEvents=[];window.addEventListener('storage',event=>{if(event.key?.startsWith('hub.public-post-peers.v1.'))window.peerStopEvents.push({key:event.key,value:event.newValue,local:event.storageArea===localStorage});});});
  await panel.getByRole('button',{name:'この端末の共有を停止',exact:true}).click({timeout:5000});
  await panel.getByText('端末間共有は停止中です。',{exact:true}).waitFor();
  assert.equal(await panel.getByText('Hubスマホ <img src=x>',{exact:false}).count(),0);
  try{await second.locator('#public-post-peers').getByText('端末間共有は停止中です。',{exact:true}).waitFor({timeout:1500});}
  catch{throw Error(JSON.stringify({phase:'other tab stop',state:await second.evaluate(()=>({events:window.peerStopEvents,text:document.querySelector('#public-post-peers')?.textContent,consent:Object.keys(localStorage).filter(k=>k.startsWith('hub.public-post-peers.v1.')).map(k=>localStorage.getItem(k))})),peers:peers.size,errors}));}
  await second.close();
  await page.waitForFunction(()=>!Object.keys(localStorage).some(k=>k.startsWith('hub.public-post-peers.v1.')&&localStorage.getItem(k)==='on'));
  for(const width of [1100,390]){await page.setViewportSize({width,height:900});await panel.scrollIntoViewIfNeeded();assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth+1||el.getBoundingClientRect().right>innerWidth+1),false);}
  if(process.env.HUB_PEER_SCREENSHOT)await panel.screenshot({path:process.env.HUB_PEER_SCREENSHOT});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,realLocalSettings:true,syntheticAccount:true,noAutomaticOptIn:true,permitAndStop:true,otherTabStops:true,widths:[1100,390],pageErrors:0}));
}finally{await browser.close();}
