'use strict';
// Synthetic server and TV API only. No household library or TV is contacted.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'../app');
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://fixture').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);});
const show={type:'show',ratingKey:'1',title:'Series 日本語 中文',summary:'A synthetic series for remote navigation.',childCount:2,leafCount:60};
const seasons=[{type:'season',ratingKey:'10',parentRatingKey:'1',title:'Season 1',index:1},{type:'season',ratingKey:'20',parentRatingKey:'1',title:'Season 2',index:2}];
const episodes=Array.from({length:30},(_,i)=>({type:'episode',ratingKey:String(200+i),title:'Hidden plot '+i,summary:'Hidden summary '+i,parentRatingKey:'20',grandparentRatingKey:'1',grandparentTitle:show.title,parentIndex:2,index:i+1,duration:1800000,viewOffset:i===3?120000:0,Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{id:String(200+i),key:'/library/parts/'+(200+i)+'/file.mp4',Stream:[]}]}]}));
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'};
async function press(page,name){await page.getByRole('button',{name,exact:true}).focus();await page.keyboard.press('Enter');}
async function focusIndex(page,index){await page.waitForFunction(index=>document.activeElement.getAttribute('data-library-index')===String(index),index);}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),requests=[],errors=[];let deck=true,hold=false,held=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   if(!localStorage.getItem('series.seeded')){localStorage.setItem('series.seeded','1');localStorage.setItem('tizenosplex.token','SYNTHETIC_SERIES');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','series-fixture');}
   window.opens=0;window.webapis={avplay:{open(){window.opens++;},setListener(listener){window.listener=listener;},setDisplayRect(){},setDisplayMethod(){},prepareAsync(ok){setTimeout(ok,5);},play(){},stop(){},close(){},getDuration(){return 1800000;},seekTo(ms,ok){ok();},setSilentSubtitle(){},setSubtitlePosition(){},getTotalTrackInfo(){return [];},getCurrentStreamInfo(){return [];}}};
  });
  await page.route('http://192.168.1.20:32400/**',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   requests.push(p+url.search);let list=[],box;
   if(p==='/photo/:/transcode'){await route.fulfill({status:404,headers});return;}
   if(p==='/library/sections')box={Directory:[{type:'show',key:'2',title:'Shows'}]};
   else if(p==='/library/metadata/1')box={Metadata:[{...show,...(deck?{OnDeck:{Metadata:[episodes[3]]}}:{})}]};
   else if(p==='/library/metadata/1/children')list=seasons;
   else if(p==='/library/metadata/20/children'||p==='/library/metadata/10/children')list=episodes;
   else if(p==='/library/metadata/1/allLeaves'){if(hold){held.push(route);return;}list=episodes;}
   else if(/^\/library\/metadata\/\d+$/.test(p))box={Metadata:[episodes.find(item=>item.ratingKey===p.split('/').pop())]};
   else if(p.includes('continueWatching')||p.includes('/recentlyAdded')||p.includes('/all'))list=[show];
   if(!box){const start=Number(url.searchParams.get('X-Plex-Container-Start'))||0,size=Number(url.searchParams.get('X-Plex-Container-Size'))||12;box={Metadata:list.slice(start,start+size),totalSize:list.length};}
   await route.fulfill({json:{MediaContainer:box},headers});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('.card').first().waitFor();
  assert.equal(requests.some(url=>url.includes('/metadata/')),false,'No speculative per-series lookup at startup');
  await page.locator('.card').first().click();await page.getByRole('button',{name:'Continue S2 · E4',exact:true}).waitFor();
  assert.equal(requests.some(url=>url.includes('/allLeaves')),false,'Plex OnDeck avoids a fallback request');
  assert.equal(await page.evaluate(()=>window.opens),0,'Opening the series never starts playback');
  assert.equal(await page.getByRole('button',{name:'Save for later',exact:true}).count(),1);
  fs.mkdirSync(path.resolve('test-results'),{recursive:true});
  for(const size of ['normal','large','normal']){
   await press(page,'Settings');await press(page,'Subtitles & accessibility');await page.getByLabel('Interface text',{exact:true}).selectOption(size);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Continue S2 · E4',exact:true}).waitFor();
   for(const name of ['Continue S2 · E4','Seasons & episodes','Save for later','Show language preferences']){
    const button=page.getByRole('button',{name,exact:true});await button.focus();
    const bounds=await button.evaluate(node=>{const r=node.getBoundingClientRect(),main=document.getElementById('main').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,mainLeft:main.left,mainRight:main.right,mainTop:main.top,mainBottom:main.bottom};});
    assert.ok(bounds.left>=bounds.mainLeft&&bounds.right<=bounds.mainRight&&bounds.top>=bounds.mainTop&&bounds.bottom<=bounds.mainBottom,name+' fits '+size+' text viewport');
   }
   await page.getByRole('button',{name:'Continue S2 · E4',exact:true}).focus();await page.screenshot({path:path.resolve('test-results/series-'+size+'.png')});
  }
  await press(page,'Show language preferences');await page.getByLabel('Show audio language',{exact:true}).selectOption('ja');await press(page,'Back to series');
  await page.getByRole('button',{name:'Continue S2 · E4',exact:true}).waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.showPreferences.series-fixture.owner.1')).audioLanguage),'ja');
  await press(page,'Seasons & episodes');await focusIndex(page,0);await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await focusIndex(page,0);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await focusIndex(page,18);await page.keyboard.press('Enter');await page.getByRole('button',{name:'All episodes',exact:true}).waitFor();
  assert.equal(await page.getByText('Hidden plot 18',{exact:true}).count(),0,'Series episode navigation preserves spoiler hiding');
  await press(page,'All episodes');await focusIndex(page,0);await page.keyboard.press('Escape');await page.getByRole('button',{name:'All episodes',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'All episodes','All episodes Back restores its actual parent action');
  await page.keyboard.press('Escape');await focusIndex(page,18);await page.keyboard.press('Escape');await focusIndex(page,1);await page.keyboard.press('Escape');await page.getByRole('button',{name:'Seasons & episodes',exact:true}).waitFor();
  await page.reload();await page.locator('.card').first().waitFor();await page.locator('.card').first().click();await page.getByRole('button',{name:'Continue S2 · E4',exact:true}).waitFor();
  await press(page,'Seasons & episodes');await focusIndex(page,1);await page.keyboard.press('Enter');await focusIndex(page,18);
  assert.ok(requests.some(url=>url.includes('/20/children?X-Plex-Container-Start=12')),'Remembered episode reload uses its paginated page');
  await page.evaluate(()=>localStorage.setItem('tizenosplex.session',JSON.stringify({server:'http://192.168.1.20:32400',serverToken:'SYNTHETIC_CHILD',userToken:'SYNTHETIC_CHILD',machineId:'series-fixture',profile:{id:'child',title:'Child'}})));
  await page.reload();await page.locator('.card').first().waitFor();await page.locator('.card').first().click();await page.getByRole('button',{name:'Continue S2 · E4',exact:true}).waitFor();await press(page,'Seasons & episodes');await focusIndex(page,0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.seriesPositions.series-fixture.child')),null,'Profile does not inherit browsing position');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Continue S2 · E4',exact:true}).waitFor();
  const before=requests.filter(url=>url.startsWith('/library/metadata/203?')).length;await press(page,'Continue S2 · E4');await page.waitForFunction(()=>window.opens===1);
  assert.equal(requests.filter(url=>url.startsWith('/library/metadata/203?')).length,before+1,'Explicit Continue refreshes full episode metadata once');
  await page.reload();await page.locator('.card').first().waitFor();deck=false;hold=true;await page.locator('.card').first().click();await page.getByRole('button',{name:'Finding next episode…',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.series-detail')!==null);await page.waitForTimeout(100);assert.ok(held.length>0);
  await page.getByRole('button',{name:'Seasons & episodes',exact:true}).focus();
  for(const pending of held)await pending.fulfill({json:{MediaContainer:{Metadata:[episodes[0]],totalSize:1}},headers}).catch(()=>{});held=[];
  await page.getByRole('button',{name:'Play S2 · E1',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Seasons & episodes','Late recommendation does not steal focus from a deliberate navigation choice');
  await page.keyboard.press('Escape');await page.locator('.card').first().waitFor();await page.locator('.card').first().click();await page.getByRole('button',{name:'Finding next episode…',exact:true}).waitFor();await page.waitForTimeout(100);
  await page.keyboard.press('Escape');await page.locator('.card').first().waitFor();for(const pending of held)await pending.fulfill({json:{MediaContainer:{Metadata:[episodes[0]],totalSize:1}},headers}).catch(()=>{});
  await page.waitForTimeout(100);assert.equal(await page.locator('.series-detail').count(),0);assert.equal(await page.evaluate(()=>window.opens),0,'Late recommendation cannot navigate or play after cancellation');
  assert.deepEqual(errors,[]);console.log('PASS: series OnDeck landing, explicit fresh Continue, spoiler safety, show languages, paginated remembered season/episode, profile isolation, All episodes parent restoration and cancelled lookup.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
