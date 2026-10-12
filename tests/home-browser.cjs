'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../app');
const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'*'};
const title = i => ['A long film title that must stay within its column', '日本語の長い映画のタイトルを表示するための作品', '用于验证海报在屏幕边缘正确显示的中文电影名称'][i % 3] + ' ' + i;
const items = (prefix, count = 6) => Array.from({length:count}, (_, i) => ({ratingKey:String(prefix + i), type:'movie', title:title(i), year:2026, thumb:'/library/metadata/' + (prefix+i) + '/thumb'}));
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://test').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html');
  fs.createReadStream(file).pipe(res);
});
async function bounds(page) {
  const state = await page.evaluate(() => {
    const main = document.getElementById('main'), r = main.getBoundingClientRect();
    const scale=document.getElementById('ui-root').getBoundingClientRect().width/1920;
    return {width:innerWidth, left:r.left, right:r.left+main.clientWidth*scale, horizontal:main.scrollLeft,
      overflow:main.scrollWidth-main.clientWidth,
      rows:Array.from(document.querySelectorAll('.home-grid,.library-grid'), grid => Array.from(grid.querySelectorAll('.card')).slice(0,6).map(card => {
        const c=card.getBoundingClientRect(), s=getComputedStyle(card);
        return {left:c.left,right:c.right,width:c.width,ring:(parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset))*scale};
      }))};
  });
  assert.equal(state.horizontal, 0);
  assert.ok(state.overflow <= 0);
  for (const row of state.rows) for (const card of row) {
    assert.ok(card.left-card.ring >= state.left && card.right+card.ring <= state.right);
    assert.ok(card.right < state.width, 'Every poster must fit the physical viewport');
    assert.ok(Math.abs(card.width-row[0].width)<1);
  }
}
async function compactBoundaryChecks(browser) {
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.setDefaultTimeout(10000);
  try {
    for(const boundary of ['top','bottom']) {
      await page.setContent('<button id="outside">Home navigation</button><main id="fixture-host"></main>');
      await page.addStyleTag({path:path.join(root,'styles.css')});
      await page.addStyleTag({content:'#fixture-host {position:absolute;top:100px;left:20px;width:1400px;height:900px;overflow:auto;overflow-anchor:none;--card-height:500px;}'});
      await page.addScriptTag({path:path.join(root,'home.js')});
      await page.evaluate(()=>{
        const host=document.getElementById('fixture-host'),pending={};
        document.getElementById('outside').focus();
        const home=new TizenHome({host,columns:6,request:path=>new Promise(resolve=>{pending[path.split('?')[0]]=resolve;}),
          extract:data=>data,ready:()=>{},leave:()=>document.getElementById('outside').focus()});
        home.mount([{key:'1',title:'Films'}]);
        window.fixture={home,pending};
        document.addEventListener('keydown',event=>{if(home.move(event.keyCode))event.preventDefault();});
        host.querySelector('[data-home-focus="continue:all"]').focus();
      });
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-1:all');
      if(boundary==='bottom')await page.locator('#fixture-host').evaluate(n=>n.scrollTop=n.scrollHeight);
      const before=await page.evaluate(()=>({top:document.activeElement.getBoundingClientRect().top,scroll:document.getElementById('fixture-host').scrollTop}));
      assert.ok(before.scroll<450,'Fixture must be unable to compensate the roughly450px collapse');
      if(boundary==='top')assert.equal(before.scroll,0);
      else assert.ok(before.scroll>0,'Bottom case must exercise a positive scroll offset that the collapse would clamp');
      const row=boundary==='top'?0:1;
      await page.evaluate(row=>fixture.pending[row?'/library/sections/1/recentlyAdded':'/hubs/continueWatching/items']({items:[]}),row);
      await page.waitForFunction(row=>fixture.home.rows[row].loaded&&fixture.home.rows[row].compactPending,row);
      const after=await page.evaluate(()=>({key:document.activeElement.getAttribute('data-home-focus'),top:document.activeElement.getBoundingClientRect().top}));
      assert.equal(after.key,'recent-1:all');
      assert.ok(Math.abs(after.top-before.top)<=1,boundary+' boundary must not move the focused View all action');
      // Verify rollback-generated scroll events cannot repeatedly collapse the
      // row, then move away by remote and check that the space is released.
      await page.waitForTimeout(100);
      assert.ok(Math.abs(await page.evaluate(()=>document.activeElement.getBoundingClientRect().top)-before.top)<=1);
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(row=>fixture.home.rows[row].node.classList.contains('home-row-empty'),row);
      assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-home-focus')),'continue:all');
      await page.evaluate(()=>fixture.home.dispose());
    }
  } finally { await page.close(); }
}
(async () => {
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || undefined});
  try {
    const page = await browser.newPage({viewport:{width:1920,height:1080}});
    page.setDefaultTimeout(10000);
    const errors=[], requests=[]; let held=[], heldEmpty=[], hold=true, holdEmpty=false, fail=true, oldContinue=false, recentCount=6;
    const focused = () => page.evaluate(()=>document.activeElement.getAttribute('data-home-focus'));
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');
      localStorage.setItem('tizenosplex.token','HOME_FIXTURE_ONLY');
      localStorage.setItem('tizenosplex.serverId','fixture');
      window.previewCalls=[];
      window.previewRequest=JSON.parse(localStorage.getItem('fixture.previewRequest')||'null');
      window.tizen={systeminfo:{getCapability:()=>true},tvinputdevice:{registerKey(){}},
        ApplicationControl:function(operation,uri,mime,category,data){Object.assign(this,{operation,data});},
        ApplicationControlData:function(key,value){Object.assign(this,{key,value});},
        application:{getCurrentApplication:()=>({getRequestedAppControl:()=>window.previewRequest}),
          launchAppControl:(control,id,success)=>{window.previewCalls.push({control,id});success();}}};
    });
    const feed = (data, route) => route.fulfill({json:{MediaContainer:data},headers});
    await page.route('http://192.168.1.20:32400/**', async route => {
      const u=new URL(route.request().url()), p=u.pathname;
      if (route.request().method()==='OPTIONS') { await route.fulfill({status:204,headers}); return; }
      requests.push(p);
      if (p==='/library/sections') return feed({Directory:[{key:'1',title:'Films',type:'movie'},{key:'2',title:'TV',type:'show'},{key:'3',title:'Other films',type:'movie'}]},route);
      if (p==='/photo/:/transcode') return route.fulfill({status:404,headers});
      if (p==='/hubs/continueWatching/items' && oldContinue) return route.fulfill({status:404,headers});
      if (p.includes('/metadata/')) return feed({Metadata:[{ratingKey:p.split('/').pop(),title:'Selected film',type:'movie'}]},route);
      if (p==='/library/sections/1/recentlyAdded' && hold) { held.push(route); return; }
      if (p==='/library/sections/2/recentlyAdded') {
        if (holdEmpty) { heldEmpty.push(route); return; }
        return feed({Metadata:[],totalSize:0},route);
      }
      if (p==='/library/sections/3/recentlyAdded' && fail) return route.fulfill({status:503,headers});
      return feed({Metadata:items(p.includes('/sections/1/')?100:200,p.includes('/sections/1/')?recentCount:6),totalSize:30},route);
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await page.locator('[data-home-focus="continue:0"]').waitFor();
    assert.deepEqual(requests.filter(p=>p!=='/photo/:/transcode').sort(),['/hubs/continueWatching/items','/library/sections'].sort(),'Initial Home uses only the existing two startup feeds');
    assert.equal(await page.locator('#focused-item').evaluate(n=>n.hidden),false,'Fresh Home reserves its focused-title area before first focus');
    assert.equal(await page.locator('.home-row').count(),4);
    assert.equal(await page.locator('.home-grid').first().locator('.card').count(),6);
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='continue:0');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-home-focus')),'continue:0');
    for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-home-focus')),'continue:5');
    await page.keyboard.press('ArrowRight'); assert.equal(await focused(),'continue:all');
    await page.keyboard.press('ArrowLeft'); assert.equal(await focused(),'continue:5');
    assert.equal(requests.filter(p=>p.includes('/metadata/')).length,0,'Focusing cards never fetches title metadata');
    await bounds(page);
    await page.waitForTimeout(200); assert.ok(held.length);
    hold=false; for(const request of held.splice(0)) await feed({Metadata:items(100),totalSize:30},request);
    await page.locator('[data-home-focus="recent-1:0"]').waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-home-focus')),'continue:5','Late rows must not steal focus');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-1:5');
    const saved=await page.locator('#main').evaluate(n=>n.scrollTop);
    await page.keyboard.press('Enter'); await page.getByRole('heading',{name:'Selected film'}).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-1:5');
    assert.equal(await page.locator('#main').evaluate(n=>n.scrollTop),saved);
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(),'continue:5','Up returns directly to the same content column');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-home-focus')),'recent-1:5');
    await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await page.locator('[data-library-index="0"]').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-1:all');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-1:5');
    assert.equal(await focused(),'recent-1:5');
    await page.keyboard.press('ArrowDown');
    await page.getByText('No recent titles in this library.',{exact:true}).waitFor();
    assert.equal(await focused(),'recent-2:all');
    const emptyHeight=await page.locator('.home-row-empty .home-grid').evaluate(n=>n.getBoundingClientRect().height);
    assert.ok(emptyHeight<140,'Confirmed empty rows must be compact');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-3:retry');
    await page.keyboard.press('ArrowUp'); assert.equal(await focused(),'recent-2:all');
    await page.keyboard.press('ArrowUp'); assert.equal(await focused(),'recent-1:5');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
    fail=false; await page.keyboard.press('Enter');
    await page.locator('[data-home-focus="recent-3:0"]').waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-home-focus')),'recent-3:0','Retry must retain usable focus');
    // A short row clamps its actual card without losing the preferred column.
    recentCount=2; await page.getByRole('button',{name:'Home',exact:true}).click();
    await page.locator('[data-home-focus="continue:0"]').waitFor();
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='continue:0');
    for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-1:1');
    await page.keyboard.press('ArrowUp'); assert.equal(await focused(),'continue:5');
    await page.keyboard.press('ArrowDown'); assert.equal(await focused(),'recent-1:1');
    await page.keyboard.press('ArrowDown'); assert.equal(await focused(),'recent-2:all');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-3:5');
    await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');assert.equal(await focused(),'recent-1:1');
    await page.keyboard.press('ArrowUp');assert.equal(await focused(),'continue:5');
    await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Home');
    recentCount=6;
    // Leaving a loading row invalidates its delayed focus handoff.
    hold=true; await page.keyboard.press('Enter');
    await page.locator('[data-home-focus="continue:0"]').waitFor();
    for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');assert.equal(await focused(),'recent-1:all');
    await page.keyboard.press('ArrowUp');assert.equal(await focused(),'continue:4');
    hold=false; for(const request of held.splice(0))await feed({Metadata:items(100),totalSize:30},request);
    await page.locator('[data-home-focus="recent-1:0"]').waitFor();assert.equal(await focused(),'continue:4');
    // Shrinking an upstream empty row must preserve downstream focus and its
    // physical screen position, including the scaled 4K canvas.
    await page.setViewportSize({width:3840,height:2160});
    holdEmpty=true;await page.getByRole('button',{name:'Home',exact:true}).click();
    await page.locator('[data-home-focus="continue:0"]').waitFor();
    await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-1:0');
    await page.keyboard.press('ArrowDown');assert.equal(await focused(),'recent-2:all');
    await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement.getAttribute('data-home-focus')==='recent-3:0');
    const beforeEmpty=await page.evaluate(()=>({key:document.activeElement.getAttribute('data-home-focus'),top:document.activeElement.getBoundingClientRect().top}));
    assert.ok(heldEmpty.length);holdEmpty=false;for(const request of heldEmpty.splice(0))await feed({Metadata:[],totalSize:0},request);
    await page.locator('.home-row-empty').waitFor();
    assert.equal(await focused(),beforeEmpty.key);
    assert.ok(Math.abs(await page.evaluate(()=>document.activeElement.getBoundingClientRect().top)-beforeEmpty.top)<=2,'Empty row completion must not move the focused card');
    await bounds(page);await page.setViewportSize({width:1920,height:1080});
    // A stale row cannot append into a library after leaving Home.
    hold=true; await page.getByRole('button',{name:'Home',exact:true}).click();
    await page.locator('[data-home-focus="continue:0"]').waitFor(); await page.waitForTimeout(200);
    await page.getByRole('button',{name:'Films',exact:true}).click(); await page.locator('[data-library-index="0"]').waitFor();
    hold=false; for(const request of held.splice(0)) await feed({Metadata:items(900)},request).catch(()=>{});
    assert.equal(await page.locator('.home-row').count(),0);
    // The nine-column grid also handles partial six-item feed rows at either size.
    for(const width of [1920,1280]) {
      await page.setViewportSize({width,height:1080});
      await page.waitForFunction(()=>document.getElementById('ui-root').getBoundingClientRect().right<=innerWidth);
      await bounds(page);
      await page.getByRole('button',{name:'Home',exact:true}).click(); await page.locator('[data-home-focus="continue:0"]').waitFor();
      await page.evaluate(()=>document.body.classList.add('large-ui'));
      await bounds(page);
      assert.equal(await page.locator('.home-grid').first().locator('.card').count(),6);
      await page.screenshot({path:path.resolve('test-results/home-'+width+'.png')});
      await page.getByRole('button',{name:'Films',exact:true}).click(); await page.locator('[data-library-index="0"]').waitFor();
    }
    oldContinue=true; await page.getByRole('button',{name:'Home',exact:true}).click(); await page.locator('[data-home-focus="continue:0"]').waitFor();
    assert.ok(requests.includes('/library/onDeck'));
    assert.equal(await page.evaluate(()=>window.previewCalls.length),0,'Preview must do no work by default');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'TV home preview',exact:true}).click();
    await page.getByLabel('Show library on TV home',{exact:true}).selectOption('on');
    await page.waitForFunction(()=>window.previewCalls.length>0);
    const snapshot=await page.evaluate(()=>JSON.parse(window.previewCalls[0].control.data[0].value[0]));
    assert.ok(snapshot.sections.length<=3);assert.ok(snapshot.sections.every(row=>row.tiles.length<=6));
    assert.ok(snapshot.sections.every(row=>row.tiles.every(tile=>!tile.image.includes('Token'))));
    // Warm and cold launcher launches open details, never playback.
    await page.evaluate(()=>{
      const scope=localStorage.getItem('tizenosplex.previewScope');
      window.previewRequest={appControl:{operation:'http://samsung.com/appcontrol/operation/eden_resume',data:[{key:'PAYLOAD',value:[JSON.stringify({values:JSON.stringify({version:1,id:'42',scope})})]}]}};
      localStorage.setItem('fixture.previewRequest',JSON.stringify(window.previewRequest));
      window.dispatchEvent(new Event('appcontrol'));
    });
    await page.getByRole('heading',{name:'Selected film'}).waitFor();
    assert.equal(await page.locator('#player-ui').evaluate(n=>n.hidden),true);
    await page.reload();await page.getByRole('heading',{name:'Selected film'}).waitFor();
    assert.equal(await page.locator('#player-ui').evaluate(n=>n.hidden),true);
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'TV home preview',exact:true}).click();
    await page.getByLabel('Show library on TV home',{exact:true}).selectOption('off');
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.previewScope')),null);
    assert.equal(await page.evaluate(()=>JSON.parse(window.previewCalls.slice(-1)[0].control.data[0].value[0]).clear),true);
    await page.evaluate(()=>window.dispatchEvent(new Event('appcontrol')));
    await page.getByRole('heading',{name:'TV home preview',exact:true}).waitFor();
    // The cancellation registry contains pending work only, including retries.
    const pendingRegistry=await page.evaluate(async()=>{
      const host=document.createElement('main');
      const home=new TizenHome({host,columns:6,request:()=>Promise.reject(new Error('fixture failure')),extract:()=>({items:[]}),ready:()=>{}});
      home.addRow('fixture','Fixture','/fixture','fixture');
      for(let i=0;i<20;i++){
        home.rows[0].failed=false;home.load(home.rows[0]);
        await Promise.resolve();await Promise.resolve();await Promise.resolve();
      }
      const retained=home.requests.length;home.dispose();return retained;
    });
    assert.equal(pendingRegistry,0,'Settled Home requests must be released');
    await compactBoundaryChecks(browser);
    assert.deepEqual(errors,[]);
    console.log('PASS: Home rows, deferred feeds, six-column bounds, multilingual larger text, edge navigation, focus/scroll restoration, empty/failing rows, Retry, stale cancellation, older-server fallback, preview opt-in/disable and cold/warm detail-only deep links.');
  } finally { await browser.close(); server.close(); }
})().catch(error => {console.error(error);server.close();process.exitCode=1;});
