'use strict';
async function dismissMenus(page){for(let i=0;i<8&&await page.locator('#playback-menu').isVisible();i++)await page.keyboard.press('Escape');}
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'../app');
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://fixture').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);});
const episode=(id,index)=>({ratingKey:String(id),type:'episode',title:'Spoiler title '+index,summary:'Secret plot '+index,thumb:'/spoiler-image-'+index,parentRatingKey:'10',grandparentRatingKey:'1',grandparentTitle:'Fixture show',parentIndex:1,index,viewCount:0,duration:1800000,Media:[{videoCodec:'h264',audioCodec:'aac',width:1920,height:1080,Part:[{id:String(id),key:'/library/parts/'+id+'/file.mkv',Stream:[{id:id+1,index:1,streamType:2,languageCode:'jpn',codec:'aac'},{id:id+2,index:2,streamType:2,languageCode:'eng',codec:'aac'}]}]}]});
const episodes=[episode(101,1),episode(102,2)],movie={...episode(201,1),type:'movie',title:'Fixture movie',thumb:'/movie-poster'};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];let failWatch=false,holdNext=false,held=[],failMetadata=false,holdMetadata=false,heldMetadata=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   if(!localStorage.getItem('seeded')){localStorage.setItem('seeded','1');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','fixture');localStorage.setItem('tizenosplex.token','FIXTURE_ONLY_SECRET');localStorage.setItem('tizenosplex.preferences.owner',JSON.stringify({audioLanguage:'en',subtitleMode:'off'}));}
   let listener,audio=8,part='';window.calls=[];
   window.webapis={avplay:{open(url){part=url.includes('/102/')?'102':url.includes('/201/')?'201':'101';audio=part==='102'?18:8;window.calls.push({action:'open',part});},setListener(value){listener=value;window.completeFixture=()=>listener.onstreamcompleted();window.advanceFixture=ms=>listener.oncurrentplaytime(ms);window.failPlaybackFixture=()=>listener.onerror("PLAYER_ERROR_CONNECTION_FAILED");},setDisplayRect(){},setDisplayMethod(){},prepareAsync(ok){setTimeout(ok,10);},play(){window.calls.push({action:'play'});},stop(){window.calls.push({action:'stop'});},close(){},getDuration(){return 1800000;},seekTo(ms,ok){window.calls.push({action:"seek",ms});ok();},setSilentSubtitle(){},setSubtitlePosition(){},getTotalTrackInfo(){return [{type:'AUDIO',index:part==='102'?17:7,extra_info:'{"language":"jpn"}'},{type:'AUDIO',index:part==='102'?18:8,extra_info:'{"language":"eng"}'}];},getCurrentStreamInfo(){return [{type:'VIDEO',index:0,extra_info:'{"fourCC":"h264"}'},{type:'AUDIO',index:audio,extra_info:'{"fourCC":"aac","channels":2}'}];},setSelectTrack(type,index){if(type==='AUDIO')audio=index;window.calls.push({action:'track',type,index});}},appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
  });
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'};
  await page.route('http://192.168.1.20:32400/**',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   requests.push({p,method:req.method(),params:Object.fromEntries(url.searchParams)});let box={};
   if(p==='/library/sections')box={Directory:[{key:'1',type:'show',title:'Shows'}]};
   else if(p==='/library/metadata/10/children'){if(holdNext){held.push(route);return;}box={Metadata:episodes,totalSize:2};}
   else if(p==='/library/metadata/1/children')box={Metadata:[{type:'season',ratingKey:'10'}],totalSize:1};
   else if(p.startsWith('/library/metadata/')){if(failMetadata){await route.fulfill({status:503,headers,body:'Fixture offline'});return;}if(holdMetadata){heldMetadata.push(route);return;}box={Metadata:[episodes.concat(movie).find(i=>i.ratingKey===p.split('/').pop())]};}
   else if(p==='/:/scrobble'||p==='/:/unscrobble'){if(failWatch){await route.fulfill({status:503,headers,body:'Fixture failure'});return;}const item=episodes.concat(movie).find(i=>i.ratingKey===url.searchParams.get('key'));item.viewCount=p==='/:/scrobble'?1:0;}
   else if(p.includes('continueWatching')||p.includes('/all'))box={Metadata:episodes.concat(movie),totalSize:3};
   else if(p==='/photo/:/transcode'){await route.fulfill({status:404,headers,body:''});return;}
   await route.fulfill({json:{MediaContainer:box},headers});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('.card').first().waitFor();
  assert.equal(await page.getByText('Spoiler title 1',{exact:true}).count(),0);assert.equal(requests.some(r=>r.p==='/photo/:/transcode'&&String(r.params.url).includes('spoiler-image')),false,'Hidden episode images must not be requested');
  await page.locator('.card').first().click();await page.getByRole('button',{name:'Reveal episode details',exact:true}).waitFor();
  assert.equal(await page.getByText('Secret plot 1',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Mark watched',exact:true}).click();await page.getByRole('button',{name:'Mark unwatched',exact:true}).waitFor();
  await page.getByRole('button',{name:'Undo watched status change',exact:true}).click();await page.getByRole('button',{name:'Mark watched',exact:true}).waitFor();
  assert.deepEqual(requests.filter(r=>/scrobble/.test(r.p)).map(r=>[r.p,r.method]),[['/:/scrobble','PUT'],['/:/unscrobble','PUT']]);
  failWatch=true;await page.getByRole('button',{name:'Mark watched',exact:true}).click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('Could not change'));assert.equal(episodes[0].viewCount,0);failWatch=false;
  await page.getByRole('button',{name:'Show language preferences',exact:true}).click();
  await page.getByLabel('Show audio language',{exact:true}).selectOption('ja');await page.getByRole('button',{name:'Back to episode',exact:true}).click();
  assert.match(await page.locator('#toast').textContent(),/saved for this show/);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c.action==='track'&&c.index===7));
  assert.equal(await page.locator('#playing-title').textContent(),'S1 · E1','Playback controls must also hide unwatched episode titles');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.preferences.owner')).audioLanguage),'en');
  assert.equal(requests.some(r=>r.p==='/library/metadata/10/children'),false,'No speculative next-episode lookup on startup');
  await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Playback info',exact:true}).click();
  assert.match(await page.getByRole('dialog').textContent(),/TV audio: aac · 2 channels/);assert.equal((await page.getByRole('dialog').textContent()).includes('FIXTURE_ONLY_SECRET'),false);
  await page.screenshot({path:path.resolve('test-results/playback-information.png')});await page.keyboard.press('Escape');
  // Cancelling a slow Next lookup must keep the current video, with no late prompt.
  holdNext=true;await dismissMenus(page);await page.locator('#control-next').click();await page.waitForTimeout(80);await page.keyboard.press('Escape');
  for(const route of held)await route.fulfill({json:{MediaContainer:{Metadata:episodes,totalSize:2}},headers}).catch(()=>{});holdNext=false;
  assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='open').length),1);
  await page.locator('#control-next').click();await page.getByRole('button',{name:'Play next episode',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Keep watching');assert.equal((await page.getByRole('dialog').textContent()).includes('Spoiler title 2'),false);
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='open').length),1);
  await page.getByRole('button',{name:'Play next episode',exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c.action==='track'&&c.index===17));
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.action==='open').map(c=>c.part)),['101','102']);
  assert.equal(await page.locator('#playing-title').textContent(),'S1 · E2','Manual Next must retain spoiler protection');
  await page.evaluate(()=>window.completeFixture());await page.getByRole('heading',{name:'Episode finished',exact:true}).waitFor();await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='open').length),2,'Finishing an episode must never autoplay');
  await page.getByText('This is the last available episode.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.locator('.card').nth(1).click();await page.getByRole('button',{name:'Play',exact:true}).waitFor();
  await page.getByRole('button',{name:'Next episode',exact:true}).click();await page.getByText('This is the last available episode. Nothing will play automatically.',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Reveal episode details',exact:true}).click();await page.getByText('Secret plot 2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Home',exact:true}).click();await page.getByText('Fixture movie',{exact:true}).first().click();await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>window.calls.filter(c=>c.action==='track'&&c.type==='AUDIO').slice(-1)[0].index===8);
  assert.equal(await page.locator('#control-next').isVisible(),false);
  await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();
  await page.evaluate(()=>{localStorage.setItem('tizenosplex.session',JSON.stringify({server:'http://192.168.1.20:32400',machineId:'fixture',serverToken:'SECOND_PROFILE_FIXTURE',userToken:'SECOND_PROFILE_FIXTURE',profile:{id:'2',title:'Second profile'}}));localStorage.setItem('tizenosplex.preferences.2',JSON.stringify({audioLanguage:'en',subtitleMode:'off'}));});
  await page.reload();await page.locator('.card').first().click();await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>window.calls.some(c=>c.action==='track'&&c.type==='AUDIO'&&c.index===8));
  assert.equal(await page.evaluate(()=>window.calls.some(c=>c.action==='track'&&c.type==='AUDIO'&&c.index===7)),false,'Another profile must not inherit this show’s Japanese override');
  await page.evaluate(()=>{window.advanceFixture(123000);window.failPlaybackFixture();});
  await page.getByRole('heading',{name:'Playback interrupted',exact:true}).waitFor();
  await page.screenshot({path:path.resolve('test-results/playback-recovery.png')});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.recoveryPositions.fixture.2'))[0].time),123000);
  const openedBeforeRetry=await page.evaluate(()=>window.calls.filter(c=>c.action==='open').length);
  failMetadata=true;await page.getByRole('button',{name:'Retry from 2:03',exact:true}).click();
  await page.getByText(/Your saved position has been kept/).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='open').length),openedBeforeRetry);
  failMetadata=false;holdMetadata=true;await page.getByRole('button',{name:'Retry from 2:03',exact:true}).click();await page.waitForTimeout(80);
  await page.getByRole('button',{name:'Return to library',exact:true}).click();await page.locator('.card').first().waitFor();
  for(const route of heldMetadata)await route.fulfill({json:{MediaContainer:{Metadata:[episodes[0]]}},headers}).catch(()=>{});holdMetadata=false;
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='open').length),openedBeforeRetry,'A cancelled Retry must never start late');
  await page.reload();await page.locator('.card').first().click();await page.getByRole('button',{name:'Resume at 2:03',exact:true}).click();
  await page.waitForFunction(()=>window.calls.some(c=>c.action==='seek'&&c.ms===123000));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tizenosplex.recoveryPositions.fixture.2')||'[]').length===0);
  await page.getByRole('button',{name:'Audio',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/Audio 1.*Japanese/}).click();
  assert.match(await page.locator('#toast').textContent(),/saved for this show/);
  await page.getByRole('button',{name:'Audio',exact:true}).click();await page.getByRole('button',{name:'Reset saved show preferences',exact:true}).click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.showPreferences.fixture.2.1')),null);assert.match(await page.locator('#toast').textContent(),/Profile defaults will apply next time/);
  assert.deepEqual(errors,[]);console.log('PASS: spoiler-safe images/details, watched status PUT/undo/failure, per-show languages across changing track indexes, movie isolation, next lookup cancellation, explicit-only next playback, no autoplay on completion, and playback info redaction.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
