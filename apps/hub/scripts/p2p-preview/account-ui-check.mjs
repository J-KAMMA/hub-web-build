// Browser interaction with synthetic discovery responses; real WebRTC and local relay.
// Authentication and SQL ownership are independently exercised by p2p-account-devices.test.ts.
import {chromium} from 'playwright';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const mf=new Miniflare(convertV4MiniflareOptions({workers:[{
  name:'account-pairing-test',modules:true,scriptPath:fileURLToPath(new URL('./worker.mjs',import.meta.url)),compatibilityDate:'2026-08-18',
  durableObjects:{PAIRS:{className:'PairingRoom',useSQLite:true}},ratelimits:{PAIRING_LIMIT:{namespace_id:'930202602',simple:{limit:60,period:60}}}
}],inspectorPort:0}));
const devices=new Map(),invitations=new Map(),browsers=[],pages=[],errors=[],registrations=[0,0];
const target=process.env.P2P_UI_URL??'http://127.0.0.1:3020/p2p';
if(!['http://127.0.0.1:3020/p2p','https://jkamma-hub-staging.jammakamma0.workers.dev/p2p'].includes(target))throw Error('Only local and approved staging targets are supported');
const live=target.startsWith('https:');
try{
  const relay=(await mf.ready).origin;
  for(let i=0;i<2;i++){
    const browser=await chromium.launch({headless:true});browsers.push(browser);
    const page=await browser.newPage({viewport:i?{width:390,height:844}:{width:1100,height:900}});pages.push(page);
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/p2p/devices*',async route=>{
      const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
      let result={ok:true};
      if(!body){const own=new URL(request.url()).searchParams.get('deviceId');result={devices:[...devices.values()],invitations:[...invitations.values()].filter(v=>v.toDevice===own).map(v=>({...v,label:devices.get(v.fromDevice)?.label,publicKey:devices.get(v.fromDevice)?.publicKey}))};}
      else if(body.action==='register'){const id=randomUUID();devices.set(id,{id,label:`${i?'Test phone':'Test PC'} ${++registrations[i]}`,publicKey:body.publicKey});result={id};}
      else if(body.action==='remove'){devices.delete(body.deviceId);for(const [id,v] of invitations)if(v.fromDevice===body.deviceId||v.toDevice===body.deviceId)invitations.delete(id);}
      else if(body.action==='invite')invitations.set(body.id,{id:body.id,fromDevice:body.deviceId,toDevice:body.toDevice,ciphertext:body.ciphertext});
      else if(body.action==='accept'||body.action==='decline')invitations.delete(body.id);
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    if(!live)await page.route('https://hub-p2p-test.jammakamma0.workers.dev/pair/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      const response=await fetch(relay+url.pathname+url.search,{method:request.method(),headers:{Origin:'http://127.0.0.1:3020'},body:request.postDataBuffer()??undefined});
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    await page.goto(target);
    await page.getByRole('heading',{name:'自分の端末',exact:true}).waitFor();
    await page.getByText('回線・中継の設定',{exact:true}).click();await page.getByLabel('STUN URL',{exact:true}).fill('');
  }
  const [a,b]=pages;
  await a.getByRole('button',{name:'この端末につなぐ',exact:true}).click({timeout:25000});
  await b.getByRole('button',{name:'接続を承認',exact:true}).waitFor({timeout:25000});
  assert.equal(await b.locator('.p2p-code').count(),0);
  assert.equal(await a.locator('[data-invitation]').count(),0);
  await b.getByRole('button',{name:'接続を承認',exact:true}).click();
  for(const page of pages)await page.locator('.p2p-code').waitFor({timeout:25000});
  assert.equal(await a.locator('.p2p-code').textContent(),await b.locator('.p2p-code').textContent());
  assert.equal(await a.locator('input[type=file]').count(),0);
  for(const page of pages)await page.getByRole('button',{name:'同じ番号であることを確認した',exact:true}).click();
  const original=randomBytes(1048579);
  await a.getByLabel('送信するファイル',{exact:true}).setInputFiles({name:'account-p2p-check.bin',mimeType:'application/octet-stream',buffer:original});
  await a.getByRole('button',{name:'このファイルを送信申請',exact:true}).click();
  await b.getByRole('button',{name:'受信する',exact:true}).waitFor();assert.equal(await b.locator('.p2p-download').count(),0);
  await b.getByRole('button',{name:'受信する',exact:true}).click();await b.locator('.p2p-download').waitFor({timeout:30000});
  const saved=b.waitForEvent('download');await b.locator('.p2p-download').click();assert.deepEqual(await readFile(await (await saved).path()),original);
  const overflow=await b.locator('.p2p-transfer').evaluate(el=>el.scrollWidth>el.clientWidth||el.getBoundingClientRect().right>innerWidth);assert.equal(overflow,false);
  if(process.env.P2P_SCREENSHOT)await b.screenshot({path:process.env.P2P_SCREENSHOT});
  await a.getByRole('button',{name:'接続を終了してやり直す',exact:true}).click();await b.waitForFunction(()=>!document.querySelector('input[type=file]'));
  await b.getByRole('button',{name:'接続を終了してやり直す',exact:true}).click();
  // Cancel a pending invitation and verify it disappears from the other screen.
  await a.locator('.p2p-device-list li').filter({hasText:'Test phone 2'}).getByRole('button',{name:'この端末につなぐ',exact:true}).click({timeout:25000});
  await b.getByRole('button',{name:'接続を承認',exact:true}).waitFor({timeout:25000});
  await a.getByRole('button',{name:'接続を終了してやり直す',exact:true}).click();
  await b.getByRole('button',{name:'接続を承認',exact:true}).waitFor({state:'detached',timeout:25000});
  assert.equal(invitations.size,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({accountDiscovery:'synthetic responses',relay:live?'published test Worker':'local Worker',transport:'real WebRTC across separate browser processes',qrRequired:false,connectionApproval:true,fileApproval:true,cancelledInvitationRemoved:true,bytes:original.length,sha256:createHash('sha256').update(original).digest('hex'),panelOverflow:false}));
}catch(error){for(const page of pages)console.error((await page.locator('.p2p-transfer').innerText().catch(()=>'')));throw error;}finally{
  for(const browser of browsers)await browser.close();await mf.dispose();
}
