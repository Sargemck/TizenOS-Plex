'use strict';
// Native-completion fixture only. All Plex traffic is intercepted; no TV or server is used.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'../app');
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://fixture').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);});
function episode(id,index,season='10'){return {ratingKey:String(id),type:'episode',title:'Secret spoiler '+id,summary:'Secret plot '+id,parentRatingKey:season,grandparentRatingKey:'1',grandparentTitle:'Synthetic series 日本語 中文',parentIndex:season==='10'?1:2,index,viewCount:0,duration:1800000,Media:[{videoCodec:'h264',audioCodec:'aac',width:1920,height:1080,Part:[{id:String(id),key:'/library/parts/'+id+'/original.mkv',Stream:[{id:id+2000,streamType:2,index:0,codec:'aac',languageCode:'eng'}]}]}]};}
const firstSeason=Array.from({length:101},(_,i)=>episode(1001+i,i+1)),current=firstSeason[99],following=firstSeason[100],last=episode(1201,1,'11');
const movie={...episode(2001,1),type:'movie',title:'Synthetic movie'},home=[current,last,movie];
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'};
(async()=>{
 fs.mkdirSync(path.resolve('test-results'),{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];let holdLookup=false,failLookup=false,holdMetadata=false,failMetadata=false,held=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   if(!localStorage.getItem('seeded')){localStorage.setItem('seeded','1');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','fixture');localStorage.setItem('tizenosplex.token','FIXTURE_ONLY');localStorage.setItem('tizenosplex.preferences.owner',JSON.stringify({subtitleMode:'off',audioLanguage:'en'}));}
   window.calls=[];let listener,time=0;
   window.webapis={avplay:{open(url){window.calls.push({action:'open',url});time=0;},setListener(value){listener=value;window.completeFixture=()=>listener.onstreamcompleted();window.timeFixture=value=>{time=value;listener.oncurrentplaytime(value);};},setDisplayRect(){},setDisplayMethod(){},prepareAsync(ok){setTimeout(ok,5);},play(){window.calls.push({action:'play'});},pause(){window.calls.push({action:'pause'});},stop(){window.calls.push({action:'stop'});},close(){},getDuration(){return 1800000;},getCurrentTime(){return time;},seekTo(value,ok){time=value;window.calls.push({action:'seek',value});ok();},setSilentSubtitle(){},setSubtitlePosition(){},getTotalTrackInfo(){return [{type:'AUDIO',index:0,extra_info:'{"language":"eng"}'}];},getCurrentStreamInfo(){return [{type:'AUDIO',index:0,extra_info:'{"language":"eng"}'}];},setSelectTrack(){}},appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
  });
  function paged(items,url){const start=Number(url.searchParams.get('X-Plex-Container-Start'))||0,size=Number(url.searchParams.get('X-Plex-Container-Size'))||12;return {Metadata:items.slice(start,start+size),totalSize:items.length,offset:start};}
  await page.route('http://192.168.1.20:32400/**',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   requests.push({p,params:Object.fromEntries(url.searchParams)});let box={};
   if(p==='/library/sections')box={Directory:[{key:'1',type:'show',title:'Shows'}]};
   else if(/^\/library\/metadata\/(10|11|1)\/children$/.test(p)){
    const items=p.includes('/10/')?firstSeason:p.includes('/11/')?[last]:[{type:'season',ratingKey:'10',index:1},{type:'season',ratingKey:'11',index:2}];box=paged(items,url);
    if(failLookup){await route.fulfill({status:503,headers,body:'Synthetic lookup failure'});return;}
    if(holdLookup){held.push({route,box});return;}
   }else if(p==='/library/metadata/1/allLeaves')box=paged(firstSeason.concat(last),url);
   else if(/^\/library\/metadata\/\d+$/.test(p)){
    const id=p.split('/').pop();let item=firstSeason.concat(last,movie).find(item=>item.ratingKey===id);
    if(id===following.ratingKey){
     if(failMetadata){await route.fulfill({status:503,headers,body:'Synthetic preparation failure'});return;}
     item=JSON.parse(JSON.stringify(item));item.Media[0].Part[0].key='/library/parts/'+id+'/fresh.mkv';item.viewOffset=15000;
    }
    box={Metadata:item?[item]:[]};if(holdMetadata&&id===following.ratingKey){held.push({route,box});return;}
   }else if(p.includes('continueWatching')||p.includes('/recentlyAdded')||p.endsWith('/all'))box=paged(home,url);
   else if(p==='/photo/:/transcode'){await route.fulfill({status:404,headers,body:''});return;}
   await route.fulfill({json:{MediaContainer:box},headers});
  });
  const count=()=>page.evaluate(()=>window.calls.filter(call=>call.action==='open').length);
  async function release(){const pending=held.splice(0);for(const {route,box}of pending)await route.fulfill({json:{MediaContainer:box},headers}).catch(()=>{});await page.waitForTimeout(80);}
  async function start(index=0,large=false){
   holdLookup=failLookup=holdMetadata=failMetadata=false;await release();
   await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
   await page.evaluate(large=>localStorage.setItem('tizenosplex.preferences.owner',JSON.stringify({subtitleMode:'off',audioLanguage:'en',largeUI:large})),large);await page.reload();
   await page.locator('.card').nth(index).click();await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.calls.some(call=>call.action==='play'));
  }
  async function complete(){await page.evaluate(()=>window.completeFixture());await page.getByRole('heading',{name:'Episode finished',exact:true}).waitFor();}
  async function nextReady(){await page.waitForFunction(()=>{const b=Array.from(document.querySelectorAll('.episode-complete button')).find(b=>b.textContent==='Play next episode');return b&&!b.disabled&&!b.hidden;});}
  async function assertBounds(){assert.deepEqual(await page.evaluate(()=>Array.from(document.querySelectorAll('.episode-complete h1,.episode-complete p,.episode-complete button')).filter(n=>n.getClientRects().length).filter(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.left<0||r.top<0||r.right>innerWidth+.5||r.bottom>innerHeight+.5||n.scrollWidth>n.clientWidth+1&&s.overflowX!=='visible';}).map(n=>n.textContent)),[]);}
  // Credits stay unobstructed until AVPlay reports actual completion.
  for(const large of [false,true]){
   await start(0,large);await page.evaluate(()=>window.timeFixture(1799000));await page.waitForTimeout(60);assert.equal(await page.locator('.episode-complete').count(),0);assert.equal(requests.filter(r=>r.p.endsWith('/children')).length,0,'No background next scan while credits run');
   holdLookup=true;await complete();await page.getByRole('button',{name:'Back to library',exact:true}).focus();holdLookup=false;await release();await nextReady();
   assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Back to library','Late lookup must not steal focus');assert.equal(await count(),1);
   assert.equal((await page.locator('.episode-complete').textContent()).includes('Secret spoiler'),false);assert.match(await page.locator('.episode-complete').textContent(),/S1.*E101/);await assertBounds();
   await page.screenshot({path:path.resolve('test-results/completion-'+(large?'large':'normal')+'.png')});
   assert.ok(requests.some(r=>r.p==='/library/metadata/10/children'&&r.params['X-Plex-Container-Start']==='100'),'Next lookup must traverse a real second page');
   await page.getByRole('button',{name:'All episodes',exact:true}).click();await page.locator('.library-grid .card').first().waitFor();assert.ok(requests.some(r=>r.p==='/library/metadata/1/allLeaves'));
   await page.keyboard.press('Escape');await page.getByRole('heading',{name:'Episode finished',exact:true}).waitFor();await nextReady();assert.equal(await count(),1);assert.equal(await page.evaluate(()=>document.activeElement.textContent),'All episodes','Back restores the actual completion parent');
   const before=requests.filter(r=>r.p==='/library/metadata/'+following.ratingKey).length;await page.getByRole('button',{name:'Play next episode',exact:true}).click();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.calls.filter(call=>call.action==='open').length===2);
   assert.equal(requests.filter(r=>r.p==='/library/metadata/'+following.ratingKey).length,before+1,'Explicit play loads fresh metadata only once');assert.ok(await page.evaluate(()=>window.calls.some(call=>call.action==='open'&&call.url.includes('/fresh.mkv'))));await page.waitForFunction(()=>window.calls.some(call=>call.action==='seek'&&call.value===15000));requests.length=0;
  }
  // Lookup errors stay in a usable completion screen and retry explicitly.
  await start();failLookup=true;await complete();await page.getByRole('button',{name:'Retry finding next episode',exact:true}).waitFor();assert.equal(await count(),1);await assertBounds();failLookup=false;await page.getByRole('button',{name:'Retry finding next episode',exact:true}).click();await nextReady();
  failMetadata=true;await page.getByRole('button',{name:'Play next episode',exact:true}).click();await page.getByText(/Could not start the next episode/).waitFor();assert.equal(await count(),1);failMetadata=false;await page.getByRole('button',{name:'Play next episode',exact:true}).click();await page.waitForFunction(()=>window.calls.filter(call=>call.action==='open').length===2);
  // Completion is absent after manual Stop, and after a movie's natural end.
  await start();await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();await page.getByRole('button',{name:'Play',exact:true}).waitFor();assert.equal(await page.locator('.episode-complete').count(),0);
  await start(2);await page.evaluate(()=>window.completeFixture());await page.getByRole('button',{name:'Play',exact:true}).waitFor();assert.equal(await page.locator('.episode-complete').count(),0);assert.equal(await count(),1);
  await start(1);await complete();await page.getByText('This is the last available episode.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Play next episode',exact:true}).isVisible(),false);assert.equal(await count(),1);
  // Aborted lookup and metadata responses cannot resurrect the completion screen or start playback.
  for(const stage of ['lookup','play'])for(const exit of ['back','library']){
   await start();if(stage==='lookup')holdLookup=true;await complete();
   if(stage==='play'){await nextReady();holdMetadata=true;await page.getByRole('button',{name:'Play next episode',exact:true}).click();}
   await page.waitForFunction(()=>document.querySelector('.episode-complete')!==null);await page.waitForTimeout(35);assert.ok(held.length,'Fixture must actually intercept the pending operation');
   if(exit==='back')await page.keyboard.press('Escape');else await page.getByRole('button',{name:'Back to library',exact:true}).click();
   await page.locator('.card').first().waitFor();holdLookup=holdMetadata=false;await release();assert.equal(await count(),1,'Cancelled '+stage+' via '+exit+' cannot play later');assert.equal(await page.locator('.episode-complete').count(),0);
  }
  assert.deepEqual(errors,[]);console.log('PASS: natural-only episode completion, credits/manual-stop/movie exclusions, paginated next lookup, spoiler-safe normal/larger screen, focus preservation, All episodes parent, explicit fresh one-shot play, errors/retry, last episode, and cancellation of late lookup/preparation.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
