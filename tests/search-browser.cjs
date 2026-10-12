'use strict';
// All Plex responses are synthetic and intercepted. No TV or account is used.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../app');
const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'};
const server = http.createServer((req,res)=>{
  const file = path.join(root,new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const mime={'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
  res.setHeader('Content-Type',mime[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});
const films = [
  {ratingKey:'1',title:'Watched fixture',viewCount:1},
  {ratingKey:'2',title:'Unwatched fixture',viewCount:0},
  {ratingKey:'3',title:'Partial 日本語 中文',viewCount:0,viewOffset:120000},
  {ratingKey:'4',title:'Rewatch fixture',viewCount:1,viewOffset:300000},
  {ratingKey:'5',title:'Another fixture',viewCount:0},
  {ratingKey:'6',title:'Last fixture',viewCount:0}
].map(item=>({...item,type:'movie',duration:600000,year:2025,summary:'Synthetic search and watch-state fixture.',Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{key:'/library/parts/'+item.ratingKey+'/file.mp4'}]}]}));
async function activate(page, name, rootLocator=page) {
  const button=rootLocator.getByRole('button',{name,exact:true});await button.focus();await page.keyboard.press('Enter');
}
async function library(page) {await activate(page,'Films');await page.locator('[data-library-index="0"]').waitFor();}
async function edit(page) {await activate(page,'Edit filters');await page.getByLabel('Title contains',{exact:true}).waitFor();}
async function submit(page,title) {
  await page.getByLabel('Title contains',{exact:true}).fill(title);await activate(page,'Show results');await page.locator('.filter-summary').waitFor();
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[],unexpected=[];
    let failFilterMetadata=false,holdWatch=false,failWatch=false;
    const pendingWatch=[];
    const watchChanges={};
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      if(localStorage.getItem('search-fixture-seeded'))return;
      localStorage.setItem('search-fixture-seeded','1');
      localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');
      localStorage.setItem('tizenosplex.serverId','fixture');
      localStorage.setItem('tizenosplex.token','SEARCH_FIXTURE_ONLY');
    });
    await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url()),p=u.pathname;
      if(u.hostname==='127.0.0.1')return route.continue();
      if(u.hostname==='plex.tv'){
        if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
        if(p==='/api/home/users')return route.fulfill({headers,contentType:'application/xml',body:'<MediaContainer><User id="2" title="Second fixture profile" protected="0"/></MediaContainer>'});
        if(p==='/api/home/users/2/switch')return route.fulfill({headers,contentType:'application/xml',body:'<user authenticationToken="SECOND_PROFILE_FIXTURE"/>'});
        if(p==='/api/v2/resources')return route.fulfill({headers,json:[{provides:'server',accessToken:'SECOND_PROFILE_FIXTURE',clientIdentifier:'fixture',name:'Fixture server',connections:[{local:true,uri:'http://192.168.1.20:32400'}]}]});
        unexpected.push(u.origin+p);return route.abort();
      }
      if(!['192.168.1.20','192.168.1.40'].includes(u.hostname)){unexpected.push(u.origin+p);return route.abort();}
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
      const token=u.searchParams.get('X-Plex-Token')||req.headers()['x-plex-token'];
      const scope=u.hostname+'.'+(token==='SECOND_PROFILE_FIXTURE'?'2':'owner');
      requests.push({p,method:req.method(),scope,params:Object.fromEntries(u.searchParams)});
      const items=films.map(item=>({...item,viewCount:watchChanges[scope+'.'+item.ratingKey]===undefined?(scope.endsWith('.2')?0:item.viewCount):watchChanges[scope+'.'+item.ratingKey]}));
      let box={};
      if(p==='/identity')box={machineIdentifier:'fixture'};
      else if(p==='/library/sections')box={Directory:[{key:'1',title:'Films',type:'movie'},{key:'2',title:'Documentaries',type:'movie'}]};
      else if(/\/(genre|year)$/.test(p)){
        if(failFilterMetadata)return route.fulfill({status:503,headers,body:'Fixture metadata unavailable'});
        box={Directory:p.endsWith('/genre')?[{key:'17',title:'Science fiction'},{key:'18',title:'Animation'}]:[{key:'2025',title:'2025'},{key:'2024',title:'2024'}]};
      } else if(p==='/:/scrobble'||p==='/:/unscrobble'){
        const finish=async()=>{
          if(failWatch)return route.fulfill({status:503,headers,body:'Synthetic watched update failure'});
          watchChanges[scope+'.'+u.searchParams.get('key')]=p==='/:/scrobble'?1:0;
          return route.fulfill({headers,json:{MediaContainer:{}}});
        };
        if(holdWatch){pendingWatch.push(finish);return;}return finish();
      }
      else if(p.startsWith('/library/metadata/'))box={Metadata:items.filter(item=>item.ratingKey===p.split('/').pop())};
      else if(p.includes('continueWatching')||p.endsWith('/all')||p.endsWith('/recentlyAdded'))box={Metadata:u.searchParams.get('title')==='No matching fixture'?[]:items,totalSize:u.searchParams.get('title')==='No matching fixture'?0:items.length};
      else if(p==='/photo/:/transcode')return route.fulfill({status:404,headers,body:''});
      await route.fulfill({headers,json:{MediaContainer:box}});
    });
    const url='http://127.0.0.1:'+server.address().port+'/index.html';
    await page.goto(url);await page.locator('.card').first().waitFor();await library(page);
    const card=index=>page.locator('[data-library-index="'+index+'"]');
    assert.equal(await card(0).locator('.watched-badge').count(),1);
    assert.equal(await card(1).locator('.watched-badge').count(),0);
    assert.equal(await card(2).locator('.card-progress').count(),1);
    assert.equal(await card(3).locator('.card-progress').count(),1);
    assert.equal(await card(3).locator('.watched-badge').count(),0);
    assert.match(await card(0).getAttribute('aria-label'),/Watched/i);
    assert.match(await card(2).getAttribute('aria-label'),/Partial 日本語 中文/);
    await card(1).focus();await page.keyboard.press('Enter');
    await activate(page,'Mark watched');await page.getByRole('button',{name:'Mark unwatched',exact:true}).waitFor();
    await page.keyboard.press('Escape');await card(1).waitFor();assert.equal(await card(1).locator('.watched-badge').count(),1);
    await card(1).focus();await page.keyboard.press('Enter');await activate(page,'Mark unwatched');
    await page.getByRole('button',{name:'Undo watched status change',exact:true}).waitFor();await activate(page,'Undo watched status change');
    await page.getByRole('button',{name:'Mark unwatched',exact:true}).waitFor();await page.keyboard.press('Escape');await card(1).waitFor();
    assert.equal(await card(1).locator('.watched-badge').count(),1,'Undo must restore the card state on Back');
    assert.deepEqual(requests.filter(r=>/scrobble/.test(r.p)).map(r=>[r.p,r.method]),[['/:/scrobble','PUT'],['/:/unscrobble','PUT'],['/:/scrobble','PUT']]);

    // A successful mutation remains authoritative after Back or reopening the
    // detail. Pending writes for this profile/title cannot overlap.
    holdWatch=true;await card(1).click();await activate(page,'Mark unwatched');
    await page.waitForTimeout(30);assert.equal(pendingWatch.length,1);
    await page.keyboard.press('Escape');await card(1).waitFor();
    assert.equal(await card(1).locator('.watched-badge').count(),1);
    await pendingWatch.shift()();holdWatch=false;
    await page.waitForFunction(()=>!document.querySelector('[data-library-index="1"] .watched-badge'));
    assert.equal(await page.locator(':focus').getAttribute('data-library-index'),'1','Late success restores the focused card');
    await activate(page,'Home');await library(page);assert.equal(await card(1).locator('.watched-badge').count(),0,'Reopening cannot reuse stale watched metadata');
    holdWatch=true;await card(1).click();await activate(page,'Mark watched');
    await page.waitForTimeout(30);await page.keyboard.press('Escape');await card(1).click();
    const pendingCount=requests.filter(r=>/scrobble/.test(r.p)).length;
    await activate(page,'Mark watched');await page.getByText('Wait for the watched status update to finish.',{exact:true}).waitFor();
    assert.equal(requests.filter(r=>/scrobble/.test(r.p)).length,pendingCount,'Reopening must not bypass the pending write guard');
    await pendingWatch.shift()();holdWatch=false;
    await page.getByRole('button',{name:'Mark unwatched',exact:true}).waitFor();
    assert.equal(await page.locator(':focus').getAttribute('id'),'watch-status-toggle','Fresh detail restores the same action when its label changes');
    failWatch=true;await activate(page,'Mark unwatched');await page.getByText(/Could not change watched status/).waitFor();
    await page.waitForFunction(()=>!document.getElementById('watch-status-toggle').disabled);
    assert.equal(await page.getByRole('button',{name:'Mark unwatched',exact:true}).count(),1,'Failure keeps the original state');
    failWatch=false;await activate(page,'Mark unwatched');await page.getByRole('button',{name:'Undo watched status change',exact:true}).waitFor();
    await activate(page,'Undo watched status change');await page.getByRole('button',{name:'Mark unwatched',exact:true}).waitFor();
    await page.keyboard.press('Escape');await card(1).waitFor();assert.equal(await card(1).locator('.watched-badge').count(),1);

    assert.equal(await page.getByRole('button',{name:'Edit filters',exact:true}).count(),1);
    await edit(page);await page.getByLabel('Genre',{exact:true}).selectOption('17');await page.getByLabel('Year',{exact:true}).selectOption('2025');
    await page.getByLabel('Watch status',{exact:true}).selectOption('unwatched');await page.getByLabel('Sort',{exact:true}).selectOption('addedAt:desc');
    await submit(page,'日本語 中文');
    assert.equal(await page.locator('.filter-summary').textContent(),'Title: 日本語 中文 · Unwatched · Science fiction · 2025 · Recently added');
    const lastQuery=requests.filter(r=>r.p.endsWith('/all')).at(-1).params;
    assert.equal(lastQuery.genre,'17');assert.equal(lastQuery.year,'2025');assert.equal(lastQuery.title,'日本語 中文');assert.equal(lastQuery.unwatched,'1');assert.equal(lastQuery.sort,'addedAt:desc');
    assert.equal('genreLabel' in lastQuery,false);assert.equal('yearLabel' in lastQuery,false);
    const labelsBefore=requests.filter(r=>/\/(genre|year)$/.test(r.p)).length;
    failFilterMetadata=true;await page.reload();await page.locator('.card').first().waitFor();await library(page);
    assert.match(await page.locator('.filter-summary').textContent(),/Science fiction/);
    assert.equal(requests.filter(r=>/\/(genre|year)$/.test(r.p)).length,labelsBefore,'Reloading a filtered library needs no label lookup');
    await edit(page);await submit(page,'日本語 中文');assert.match(await page.locator('.filter-summary').textContent(),/Science fiction/);
    failFilterMetadata=false;
    await activate(page,'Documentaries');await page.locator('.filter-summary').waitFor();assert.equal(await page.locator('.filter-summary').textContent(),'Title A–Z');
    await library(page);assert.match(await page.locator('.filter-summary').textContent(),/Science fiction/);
    await activate(page,'Clear filters');await card(0).waitFor();assert.equal(await page.locator('.filter-summary').textContent(),'Title A–Z');

    for(const title of ['One','Two','Three','Four','Five','中文映画']){await edit(page);await submit(page,title);}
    await edit(page);
    const historyKey='tizenosplex.recentSearches.fixture.owner';
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),historyKey),['中文映画','Five','Four','Three','Two']);
    const recent=page.locator('.recent-searches');
    await recent.getByRole('button',{name:'Five',exact:true}).focus();
    const beforeFocus=requests.filter(r=>r.p.endsWith('/all')).length;await page.keyboard.press('ArrowDown');await page.waitForTimeout(100);
    assert.equal(requests.filter(r=>r.p.endsWith('/all')).length,beforeFocus,'Focusing and navigating recent searches must not submit');
    await recent.getByRole('button',{name:'Five',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('.filter-summary').waitFor();
    assert.equal(await page.locator('.filter-summary').textContent(),'Title: Five · Title A–Z','Activating history opens that query, including a cached result');
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),historyKey),['Five','中文映画','Four','Three','Two']);
    await edit(page);await submit(page,'fIvE');assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),historyKey),['fIvE','中文映画','Four','Three','Two']);
    await page.reload();await page.locator('.card').first().waitFor();await library(page);await edit(page);
    await recent.getByRole('button',{name:'fIvE',exact:true}).waitFor();
    await submit(page,'No matching fixture');await page.getByRole('heading',{name:'No matching titles',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Edit filters',exact:true}).count(),1);
    assert.match(await page.locator('.filter-summary').textContent(),/No matching fixture/);

    // Each reload below emulates a completed profile/server switch without any
    // account credentials, discovery calls or real household server access.
    const ownerHistory=await page.evaluate(key=>localStorage.getItem(key),historyKey);
    await page.evaluate(()=>localStorage.setItem('tizenosplex.session',JSON.stringify({server:'http://192.168.1.20:32400',machineId:'fixture',serverToken:'SECOND_PROFILE_FIXTURE',userToken:'SECOND_PROFILE_FIXTURE',profile:{id:'2',title:'Second fixture profile'}})));
    await page.reload();await page.locator('.card').first().waitFor();await library(page);
    assert.equal(await page.locator('.filter-summary').textContent(),'Title A–Z');assert.equal(await card(1).locator('.watched-badge').count(),0,'A second profile must not inherit owner watched changes');
    await edit(page);assert.equal(await recent.getByRole('button',{name:'fIvE',exact:true}).count(),0);await submit(page,'Second profile search');
    await page.evaluate(()=>{localStorage.removeItem('tizenosplex.session');localStorage.setItem('tizenosplex.server','http://192.168.1.40:32400');localStorage.setItem('tizenosplex.serverId','other-fixture');});
    await page.reload();await page.locator('.card').first().waitFor();await library(page);await edit(page);
    assert.equal(await recent.getByRole('button',{name:'fIvE',exact:true}).count(),0);assert.equal(await recent.getByRole('button',{name:'Second profile search',exact:true}).count(),0);
    await submit(page,'Other server search');
    await page.evaluate(()=>{localStorage.removeItem('tizenosplex.session');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','fixture');});
    await page.reload();await page.locator('.card').first().waitFor();await activate(page,'Films');await page.locator('.filter-summary').waitFor();await edit(page);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),historyKey),ownerHistory);
    await activate(page,'Clear history');assert.equal(await recent.getByRole('button',{name:'fIvE',exact:true}).count(),0);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'[]'),historyKey),[]);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.recentSearches.fixture.2'))),['Second profile search']);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.recentSearches.other-fixture.owner'))),['Other server search']);

    // Switch through the real profile UI while an owner PUT is outstanding.
    // Its late result must not rebuild the child profile's view or clear focus.
    await activate(page,'Films');await activate(page,'Clear filters');await card(1).click();holdWatch=true;
    await activate(page,'Mark unwatched');await page.waitForTimeout(30);assert.equal(pendingWatch.length,1);
    await activate(page,'Profiles');await activate(page,'Second fixture profile');await activate(page,'Switch profile');
    await page.locator('.card').first().waitFor();await library(page);await card(1).focus();await page.waitForTimeout(250);
    const beforeOwnerCompletion=requests.length;
    await pendingWatch.shift()();holdWatch=false;await page.waitForTimeout(100);
    assert.equal(requests.length,beforeOwnerCompletion,'An old profile mutation must not request or refresh another profile');
    assert.equal(await card(1).locator('.watched-badge').count(),0);
    assert.equal(await page.locator(':focus').getAttribute('data-library-index'),'1');
    assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
    console.log('PASS: readable filters and scoped recent searches; watched/partial/rewatch cards; PUT/Undo, delayed success after Back/reopen, duplicate mutation guard, failure retry and live profile-switch isolation.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
