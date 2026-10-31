// Actual Desktop markup and read coordinators, with synthetic IPC and no user account access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=new URL('../../hub-desktop/ui/',import.meta.url),allowed=new Set(['index.html','styles.css','app.js','hub-read-recovery.mjs']);
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 if(!allowed.has(name)){res.writeHead(404);res.end();return;}
 const body=await readFile(new URL(name,root),'utf8');res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript':'text/html');
 res.end(name==='index.html'?body.replace('<script type="module" src="./app.js"></script>',''):body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const kind of ['feed','shop']){
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async kind=>{
   const helpers=await import('/hub-read-recovery.mjs'),source=await(await fetch('/app.js')).text();
   document.querySelectorAll('.view.on').forEach(el=>el.classList.remove('on'));
   document.querySelector(kind==='feed'?'#view-feed':'#view-market').classList.add('on');
   const f=window.fixture={kind,error:'',items:[{id:'one',title:'表示済みの内容'}],gate:null,calls:0};
   const element=text=>Object.assign(document.createElement('article'),{textContent:text||''});
   const feed={state:document.querySelector('#feed-state'),list:document.querySelector('#feed-posts')};
   // The production IDs are resolved from the actual markup rather than copied fixture markup.
   const feedBindings=source.match(/const feed = \{([\s\S]*?)\n\};/);
   if(!feed.list){const id=feedBindings?.[1].match(/list: document.querySelector\("([^"]+)"\)/)?.[1];feed.list=document.querySelector(id);}
   if(!feed.state){const id=feedBindings?.[1].match(/state: document.querySelector\("([^"]+)"\)/)?.[1];feed.state=document.querySelector(id);}
   const shop={visible:[],products:[],hubProducts:[],remoteProducts:[],networkProducts:[],query:'',sellerFilter:null,cart:{}};
   const read=async()=>{f.calls++;if(f.gate)await f.gate;if(f.error)throw f.error;return f.items;};
   const bindings={...helpers,document,window,desktopAccount:{state:'registered',deviceId:'synthetic'},currentView:kind==='feed'?'feed':'market',feed,feedScope:'recommended',feedLoadFailed:false,feedLoadRevision:0,feedMore:element(),feedFresh:element(),feedFreshItems:[],feedSeenId:null,feedPage:{},feedSeenKey:()=>'',localStorage,
    hubNetwork:{ready:Promise.resolve(),context:()=>'',errors:()=>[],failedOrigins:()=>[],includePrimary:()=>true,load:async()=>[]},shop,
    invoke:async(name,args)=>{if(name==='hub_feed')return {posts:await read(),signedIn:true,hasMore:false};if(name==='hub_client')return {items:[]};if(name==='hub_resource')return args.resource==='shopping_products'?{products:[]}:{resources:[]};throw Error('unexpected IPC');},
    fetchShopCatalog:async()=>({listed:await read(),data:{paymentsEnabled:true},nextCursor:null}),settleWithin:p=>p,
    renderFeedPosts:posts=>feed.list.replaceChildren(...posts.map(p=>element(p.title))),renderShopResults:()=>document.querySelector('#shop-results').replaceChildren(...shop.visible.map(p=>element(p.title))),
    updateSourceSummary(){},updateCartBadge(){},skeletonPost:()=>element('読み込み中'),skeletonResult:()=>element('読み込み中'),accountNeeded:e=>e==='desktop_not_connected',activityPubUrl:()=>null,
    emptyState:(icon,title,description)=>element([title,description].filter(Boolean).join(' ')),friendlyError:String,connectState:()=>element('ログインが必要です'),retryButton:fn=>{const button=document.createElement('button');button.textContent='再試行';button.onclick=fn;return button;}};
   const block=kind==='feed'?source.slice(source.indexOf('const feedAccountKey='),source.indexOf('async function loadMoreFeed()')):source.slice(source.indexOf('let shopLoadVersion ='),source.indexOf('// 検索・絞り込みはサーバー側。'));
   f.load=new Function(...Object.keys(bindings),block+`\nreturn ${kind==='feed'?'loadFeed':'loadShop'};`)(...Object.values(bindings));
   f.target=kind==='feed'?feed.list:document.querySelector('#shop-results');f.status=kind==='feed'?feed.state:document.querySelector('#shop-state');
   await f.load();
  },kind);
  assert.equal(await page.evaluate(()=>fixture.target.textContent),'表示済みの内容');
  await page.evaluate(()=>{fixture.gate=new Promise(resolve=>fixture.finish=resolve);void fixture.load();});
  assert.equal(await page.evaluate(()=>fixture.target.textContent),'表示済みの内容');
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>fixture.status.scrollWidth>fixture.status.clientWidth+1),false,`${kind} waiting text overflow`);
  }
  await page.evaluate(()=>{fixture.error='network_timeout';fixture.finish();fixture.gate=null;});
  await page.waitForFunction(()=>fixture.status.textContent.includes('応答を待っています'));
  assert.equal(await page.evaluate(()=>fixture.target.textContent),'表示済みの内容');
  if(process.env.HUB_READ_WAIT_SCREENSHOT)await page.locator(kind==='feed'?'#view-feed':'#view-market').screenshot({path:`${process.env.HUB_READ_WAIT_SCREENSHOT}-${kind}.png`});
  await page.evaluate(()=>{fixture.error='';fixture.items=[{id:'two',title:'自動取得した内容'}];});
  await page.waitForFunction(()=>fixture.target.textContent==='自動取得した内容');
  assert.ok(await page.evaluate(()=>fixture.calls>=3));
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({coordinators:['feed','shop'],retainedDuringWait:true,automaticRecovery:true,widths:[1280,390],pageErrors:0,authentication:'synthetic IPC'}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
