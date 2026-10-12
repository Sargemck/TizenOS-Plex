'use strict';
// Synthetic responses only. These checks never access a TV, Plex account or server.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../app');
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,OPTIONS'};
const movie=id=>({ratingKey:String(id),type:'movie',title:'Saved fixture '+id,year:2026,duration:600000,summary:'Synthetic saved-list fixture.',Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{key:'/library/parts/'+id+'/file.mp4'}]}]});
async function activate(page,name){await page.getByRole('button',{name,exact:true}).focus();await page.keyboard.press('Enter');}
async function list(page){await activate(page,'My List');await page.getByRole('heading',{name:'My List',exact:true}).waitFor();}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[],unexpected=[];
    let missing=new Set(),delay=30,inFlight=0,maxFlight=0,titleSuffix='',screenshotMode=false;
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      if(localStorage.getItem('saved-fixture-seeded'))return;
      localStorage.setItem('saved-fixture-seeded','1');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');
      localStorage.setItem('tizenosplex.serverId','fixture');localStorage.setItem('tizenosplex.token','SAVED_FIXTURE_ONLY');
    });
    await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url()),p=u.pathname;
      if(u.hostname==='127.0.0.1')return route.continue();
      if(u.hostname!=='192.168.1.20'){unexpected.push(u.origin+p);return route.abort();}
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
      requests.push(p);let box={};
      if(p==='/library/sections')box={Directory:[{key:'1',title:'Films',type:'movie'}]};
      else if(p.startsWith('/library/metadata/')){
        inFlight++;maxFlight=Math.max(maxFlight,inFlight);await new Promise(r=>setTimeout(r,delay));inFlight--;
        const id=p.split('/').pop();if(missing.has(id))return route.fulfill({status:503,headers,body:'Synthetic unavailable title'});
        box={Metadata:[screenshotMode?{...movie(id),type:id==='18'?'show':'movie',title:(id==='18'?'Saved series 日本語 中文':'Saved film '+id),thumb:'/library/metadata/'+id+'/thumb'}:{...movie(id),title:movie(id).title+titleSuffix}]};
      }else if(p==='/photo/:/transcode'){
        const id=(u.searchParams.get('url')||'').split('/')[3]||'1';
        return route.fulfill({headers:{...headers,'content-type':'image/svg+xml'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="'+(id==='18'?'#345462':'#2d4f3a')+'"/><circle cx="120" cy="140" r="65" fill="#8ba570"/><path d="M20 290L110 175L220 290" fill="#193726"/><text x="120" y="330" text-anchor="middle" fill="white" font-family="Arial" font-size="24">'+(id==='18'?'SERIES':'FILM '+id)+'</text></svg>'});
      }else if(p.includes('continueWatching')||p.endsWith('/all')||p.endsWith('/recentlyAdded'))box={Metadata:[movie(1),movie(2)],totalSize:2};
      await route.fulfill({headers,json:{MediaContainer:box}}).catch(()=>{});
    });
    const url='http://127.0.0.1:'+server.address().port+'/index.html',key='tizenosplex.savedTitles.fixture.owner';
    await page.goto(url);await page.locator('.card').first().waitFor();
    assert.equal(requests.filter(p=>p.startsWith('/library/metadata/')).length,0,'Startup must not fetch saved metadata');
    await list(page);await page.getByRole('heading',{name:'Save something for later'}).waitFor();
    assert.match(await page.locator('#main').innerText(),/Saved on this TV/);
    await activate(page,'Films');await page.locator('[data-library-index="0"]').focus();await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Save for later',exact:true}).waitFor();
    await activate(page,'Save for later');assert.equal(await page.getByRole('button',{name:'Remove from My List',exact:true}).getAttribute('aria-pressed'),'true');
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),[{id:'1',type:'movie'}]);
    titleSuffix=' refreshed';await list(page);await page.locator('.card').filter({hasText:'Saved fixture 1 refreshed'}).waitFor();
    await page.locator('[data-library-index="0"]').focus();await page.keyboard.press('Enter');await activate(page,'Remove from My List');
    await page.keyboard.press('Escape');await page.getByRole('heading',{name:'Save something for later'}).waitFor();
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),[]);

    // Progressive loading retains focus and order, survives a failure and caps work at three requests.
    await page.evaluate(key=>localStorage.setItem(key,JSON.stringify(Array.from({length:20},(_,i)=>({id:String(i+1),type:'movie'})))),key);
    missing=new Set(['2']);delay=120;maxFlight=0;await list(page);
    await page.locator('[data-library-index="0"]').focus();
    await page.waitForFunction(()=>document.querySelectorAll('.card-title')[0].textContent==='Saved fixture 1 refreshed');
    assert.equal(await page.locator(':focus').getAttribute('data-library-index'),'0');
    await page.waitForFunction(()=>document.querySelector('.library-status').textContent==='');assert.ok(maxFlight<=3,'Metadata concurrency must not exceed three');
    await page.locator('[data-library-index="1"]').focus();await page.keyboard.press('Enter');
    await page.getByRole('heading',{name:'Saved title unavailable'}).waitFor();missing.clear();await activate(page,'Retry this title');
    await page.locator('[data-library-index="1"]').filter({hasText:'Saved fixture 2 refreshed'}).waitFor();
    assert.equal(await page.locator(':focus').getAttribute('data-library-index'),'1');
    missing.add('2');await list(page);await page.locator('[data-library-index="1"]').filter({hasText:'unavailable'}).waitFor();
    await page.locator('[data-library-index="1"]').focus();await page.keyboard.press('Enter');await activate(page,'Remove from My List');
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).some(x=>x.id==='2'),key),false);
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).length,key),19);
    await activate(page,'Home');await new Promise(r=>setTimeout(r,250));

    // Leaving cancels queued work and late responses cannot change the new screen.
    delay=250;const before=requests.length;await list(page);await activate(page,'Home');await new Promise(r=>setTimeout(r,500));
    assert.ok(requests.slice(before).filter(p=>p.startsWith('/library/metadata/')).length<=3);
    assert.equal(await page.getByRole('heading',{name:'My List',exact:true}).count(),0);

    // Stable, fully loaded mixed lists fit two full rows and leave the local-storage label above cards.
    screenshotMode=true;missing.clear();delay=20;
    await page.evaluate(key=>localStorage.setItem(key,JSON.stringify(Array.from({length:18},(_,i)=>({id:String(i+1),type:i===17?'show':'movie'})))),key);
    fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});
    for(const large of [false,true]){
      await page.evaluate(large=>localStorage.setItem('tizenosplex.preferences.owner',JSON.stringify({largeUI:large})),large);
      await page.reload();await page.locator('.card').first().waitFor();await list(page);
      await page.waitForFunction(()=>document.querySelector('.library-status').textContent===''&&document.querySelectorAll('#main .card img').length===18);
      await page.locator('[data-library-index="0"]').focus();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.poster img')).every(img=>img.complete&&img.naturalWidth>0));
      const bounds=await page.evaluate(()=>{
        const box=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
        return {main:box(document.querySelector('#main')),heading:box(document.querySelector('.page-heading')),label:box(document.querySelector('.filter-summary')),cards:Array.from(document.querySelectorAll('#main .card')).map(box)};
      });
      assert.equal(new Set(bounds.cards.slice(0,9).map(r=>r.top)).size,1,'Nine posters occupy the first row');
      assert.equal(new Set(bounds.cards.slice(9).map(r=>r.top)).size,1,'Nine posters occupy the second row');
      assert.ok(bounds.label.bottom<=bounds.cards[0].top-7,'Saved on this TV label must clear the focused card outline');
      assert.ok(bounds.heading.bottom<=bounds.cards[0].top-7,'Sticky heading must clear the focused card outline');
      assert.ok(bounds.cards[17].bottom+7<=bounds.main.bottom,'Two complete rows plus the focus outline fit');
      assert.ok(bounds.cards.every(r=>r.left-7>=bounds.main.left&&r.right+7<=bounds.main.right),'Every card outline fits horizontally');
      await page.screenshot({path:path.resolve(__dirname,'../test-results/saved-list-'+(large?'large':'normal')+'.png')});
    }
    screenshotMode=false;await page.evaluate(()=>localStorage.setItem('tizenosplex.preferences.owner',JSON.stringify({largeUI:false})));

    // Persisted entries are isolated by profile and server; they are never read or hydrated at startup.
    const beforeReload=requests.filter(p=>p.startsWith('/library/metadata/')).length;await page.reload();await page.locator('.card').first().waitFor();
    assert.equal(requests.filter(p=>p.startsWith('/library/metadata/')).length,beforeReload);
    await page.evaluate(()=>localStorage.setItem('tizenosplex.session',JSON.stringify({server:'http://192.168.1.20:32400',machineId:'fixture',userToken:'SECOND_FIXTURE',serverToken:'SECOND_FIXTURE',profile:{id:'2',title:'Second fixture'}})));
    await page.reload();await page.locator('.card').first().waitFor();await list(page);await page.getByRole('heading',{name:'Save something for later'}).waitFor();
    await page.evaluate(()=>{localStorage.removeItem('tizenosplex.session');localStorage.setItem('tizenosplex.serverId','other-fixture');});
    await page.reload();await page.locator('.card').first().waitFor();await list(page);await page.getByRole('heading',{name:'Save something for later'}).waitFor();
    await page.evaluate(()=>{localStorage.removeItem('tizenosplex.session');localStorage.setItem('tizenosplex.serverId','fixture');});
    await page.reload();await page.locator('.card').first().waitFor();

    // Full lists reject additions without eviction; storage failures never claim a successful mutation.
    await page.evaluate(key=>localStorage.setItem(key,JSON.stringify(Array.from({length:100},(_,i)=>({id:String(i+10),type:'movie'})))),key);
    delay=20;await activate(page,'Films');await page.locator('[data-library-index="0"]').focus();await page.keyboard.press('Enter');
    await activate(page,'Save for later');assert.match(await page.locator('#toast').textContent(),/100 titles/);
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).length,key),100);
    await page.evaluate(key=>{localStorage.setItem(key,'[]');const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.indexOf('savedTitles.')>=0)throw new Error('Synthetic quota failure');return original.call(this,k,v);};},key);
    await activate(page,'Save for later');assert.match(await page.locator('#toast').textContent(),/Could not update My List/);
    assert.equal(await page.getByRole('button',{name:'Save for later',exact:true}).count(),1);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),[]);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    console.log('Saved-list browser checks passed: scope/persistence, fresh metadata, bounded progressive loading, cancellation, retries/removal, focus, capacity and storage failures.');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
