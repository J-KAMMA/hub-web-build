// Bundled desktop markup and CSS, synthetic IPC; no real posts, keys, or delivery.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const ui=new URL('../../hub-desktop/ui/',import.meta.url);
const allowed=new Set(['index.html','styles.css','node-post-composer.mjs','node-post-detail.mjs']);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!allowed.has(path)){res.writeHead(404);res.end();return;}
  const body=await readFile(new URL(path,ui),'utf8');
  res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.mjs')?'text/javascript':'text/html');
  res.end(path==='index.html'?body.replace('<script type="module" src="./app.js"></script>',''):body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const initialize=async(state=null)=>page.evaluate(async(state)=>{
    const {createNodePostComposer}=await import('/node-post-composer.mjs');
    const f=window.fixture=state??{calls:[],offline:true,posts:[],fullBody:'',acknowledged:[]};
    const textarea=document.querySelector('#composer-text');
    window.controller=createNodePostComposer({document,form:document.querySelector('#composer'),textarea,post:document.querySelector('#composer-post'),note:document.querySelector('#composer-note'),getAccount:()=>({state:'signed_out'}),hasImages:()=>false,audience:document.querySelector('#composer-audience'),scheduledAt:document.querySelector('#composer-schedule-at'),manage:()=>{},invoke:async(name,args)=>{
      f.calls.push({name,args});
      if(name==='node_public_posts')return f.posts;
      if(name==='hub_peer_control'&&args.action==='list')return{peers:[{peerId:'one',nodeId:'https://hub-one.example/'},{peerId:'two',nodeId:'https://hub-two.example/'}]};
      if(name==='preview_public_content')return{previewId:'preview-one',contentId:'content-one',body:args.input.body,kind:'post',visibility:'public',nodeUrl:'https://my-node.example/'};
      const detail=()=>({sequence:1,portableEventId:'event-one',body:f.fullBody,createdAt:'2026-10-01T00:00:00Z',nodeUrl:'https://my-node.example/',deliveries:['one','two'].map(peerId=>({peerId,nodeUrl:`https://hub-${peerId}.example/`,status:f.acknowledged.includes(peerId)?'accepted':'unconfirmed',retryable:!f.acknowledged.includes(peerId)}))});
      if(name==='publish_public_content'){f.fullBody=textarea.value;f.posts=[{contentId:'content-one',sequence:1,body:f.fullBody.slice(0,500),truncated:true,createdAt:'2026-10-01T00:00:00Z'}];return{status:'queued',previewId:'preview-one',contentId:'content-one',sequence:1,portableEventId:'event-one'};}
      if(name==='node_public_post_control'&&['plan','detail'].includes(args.action))return detail();
      if(name==='node_public_post_control'&&args.action==='retry'){if(f.offline)throw Error('接続先は停止中です');f.acknowledged.push(args.peerId);return detail();}
      if(name==='hub_peer_control'&&args.action==='deliver'){if(f.offline&&args.peerId==='two')throw Error('接続先は停止中です');f.acknowledged.push(args.peerId);return{status:'accepted',portableEventId:'event-one'};}
      throw Error('Unexpected IPC');
    }});
    document.querySelector('#composer').onsubmit=event=>{event.preventDefault();void controller.submit();};
  },state);
  await initialize();
  await page.getByLabel('投稿の保存先').selectOption('node');
  await page.locator('#composer-text').fill('中央Hubが止まっても、自分のノードに原本が残る公開投稿。\n'.repeat(40));
  await page.getByText('配信先を選ぶ',{exact:true}).click();
  await page.getByLabel('https://hub-one.example/',{exact:true}).check();
  await page.getByLabel('https://hub-two.example/',{exact:true}).check();
  await page.locator('#composer-post').click();
  await page.getByText('公開原本の確認',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='publish_public_content').length),0);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('#composer').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`composer overflow at ${width}`);
  }
  if(process.env.HUB_NODE_POST_SCREENSHOT)await page.locator('#composer').screenshot({path:process.env.HUB_NODE_POST_SCREENSHOT});
  await page.getByRole('button',{name:'原本を保存して選択先へ配信',exact:true}).click();
  await page.locator('#composer-note').filter({hasText:'1/2件へ配信'}).waitFor();
  assert.equal(await page.locator('#node-public-posts article').count(),1);
  const restored=await page.evaluate(()=>JSON.parse(JSON.stringify(fixture)));
  await page.reload();
  await initialize(restored);
  await page.getByRole('button',{name:'全文・配信状況',exact:true}).click();
  await page.locator('#node-post-detail [data-original-body]').waitFor();
  assert.equal(await page.locator('#node-post-detail .detail-p').first().textContent(),restored.fullBody);
  await page.locator('#node-post-detail').getByRole('button',{name:'配信状況',exact:true}).click();
  await page.locator('#node-post-detail').getByText('受領を確認済み',{exact:true}).waitFor();
  assert.equal(await page.locator('#node-post-detail [data-peer-id="one"] button').count(),0);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('#node-post-detail').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`detail overflow at ${width}`);
  }
  if(process.env.HUB_NODE_DETAIL_SCREENSHOT)await page.locator('#node-post-detail').screenshot({path:process.env.HUB_NODE_DETAIL_SCREENSHOT});
  await page.getByRole('button',{name:'この配信先へ再試行',exact:true}).click();
  assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.args?.action==='retry').length),0);
  await page.evaluate(()=>{fixture.offline=false;});
  await page.getByRole('button',{name:'確認して配信',exact:true}).click();
  await page.locator('#node-post-detail').getByText('配信記録を更新しました。',{exact:true}).waitFor();
  assert.equal(await page.locator('#node-post-detail').getByText('受領を確認済み',{exact:true}).count(),2);
  assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='publish_public_content').length),1);
  assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.args?.action==='deliver'&&c.args.peerId==='one').length),1);
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.args?.action==='retry'&&c.args.peerId==='two').length),1);
  console.log(JSON.stringify({authentication:'synthetic IPC',previewDoesNotPublish:true,localOriginalSurvivesPeerFailure:true,reloadRestoresFullOriginalAndDelivery:true,failedPeerOnlyRetry:true,widths:[1280,390],pageErrors:0}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
