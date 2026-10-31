// Synthetic profile preferences, real public catalog HTTP reads, real Hub UI.
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const servers=[],requests=[];let saved=[],secondAvailable=true;
for(const name of ['A','B']) {
  const server=createServer((req,res)=>{
    requests.push({name,cookie:!!req.headers.cookie,authorization:!!req.headers.authorization,referer:!!req.headers.referer});
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');
    if(name==='B'&&!secondAvailable){res.writeHead(503);res.end('{}');return;}
    const kind=new URL(req.url,'http://localhost').searchParams.get('kind');
    res.end(JSON.stringify({protocol:'hub.catalog.v1',kind,items:[{id:'same-id',title:`Hub ${name} ${kind}`,summary:`公開カタログ ${name}`,path:`/v2/${kind==='post'?'posts':'market/products'}/same-id`,updatedAt:'2026-09-30T00:00:00Z'}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
}
const origins=servers.map(server=>`http://127.0.0.1:${server.address().port}`),browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext(),page=await context.newPage();
  await context.route('**/api/network/sources',async route=>{
    if(route.request().method()==='POST') {const {action,origin}=route.request().postDataJSON();saved=action==='add'?[...new Set([...saved,origin])]:saved.filter(s=>s!==origin);}
    await route.fulfill({contentType:'application/json',body:JSON.stringify({sources:saved})});
  });
  await page.goto('http://127.0.0.1:3020/v2/settings#hub-connections');
  const settings=page.locator('#hub-connections');await settings.waitFor();
  for(const origin of origins){await settings.getByLabel('HubのURL').fill(origin);await settings.getByRole('button',{name:'追加',exact:true}).click();await settings.getByText('追加しました。SNSとマーケットに自動で表示します。',{exact:true}).waitFor();}
  await page.goto('http://127.0.0.1:3020/v2');
  await page.locator('[data-hub-origin]').nth(1).waitFor();assert.equal(await page.locator('[data-hub-origin]').count(),2);
  assert.equal(await page.locator(`.v2-feed [data-hub-origin="${origins[0]}"]`).count(),1);
  assert.equal(await page.locator(`.v2-feed [data-hub-origin="${origins[1]}"]`).count(),1);
  secondAvailable=false;
  await page.goto('http://127.0.0.1:3020/v2/market');
  await page.locator('.v2-pgrid [data-hub-origin]').waitFor();
  await page.getByText(/に接続できません。ほかのHubの内容を表示しています。/).waitFor();
  assert.equal(await page.locator('.v2-pgrid [data-hub-origin]').count(),1);
  await page.setViewportSize({width:390,height:844});
  const card=page.locator('.v2-pgrid [data-hub-origin]');await card.scrollIntoViewIfNeeded();
  assert.equal(await card.evaluate(el=>el.scrollWidth>el.clientWidth||el.getBoundingClientRect().right>innerWidth),false);
  if(process.env.HUB_NETWORK_SCREENSHOT)await page.screenshot({path:process.env.HUB_NETWORK_SCREENSHOT});
  await page.goto('http://127.0.0.1:3020/v2/settings#hub-connections');
  await settings.getByRole('button',{name:'外す',exact:true}).first().click();
  await settings.getByText('接続先から外しました。',{exact:true}).waitFor();
  assert.deepEqual(saved,[origins[1]]);
  assert.ok(requests.length>=5);assert.ok(requests.every(r=>!r.cookie&&!r.authorization&&!r.referer));
  console.log(JSON.stringify({preferences:'synthetic profile API',catalogs:'two independent HTTP servers',sameIdSeparate:true,feedMixed:true,marketMixed:true,oneServerUnavailable:true,noCredentialsOrReferrer:true,mobileOverflow:false,removeSaved:true}));
} finally {await browser.close();for(const server of servers)await new Promise(resolve=>server.close(resolve));}
