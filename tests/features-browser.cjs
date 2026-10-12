'use strict';
async function dismissMenus(page){for(let i=0;i<8&&await page.locator('#playback-menu').isVisible();i++)await page.keyboard.press('Escape');}
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'../app'),out=path.resolve(__dirname,'../test-results');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const file=path.join(app,new URL(req.url,'http://test').pathname);
  if(!file.startsWith(app+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const mime={'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
  res.setHeader('Content-Type',mime[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});
const movie={ratingKey:'42',type:'movie',title:'Fixture Film',duration:3600000,viewOffset:20000,Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{id:'80',key:'/library/parts/80/file.mkv',indexes:'sd',Stream:[{id:'10',streamType:2,languageCode:'eng',codec:'aac'},{id:'12',streamType:2,languageCode:'jpn',codec:'aac'},{id:'11',streamType:3,languageCode:'jpn',language:'Japanese',codec:'srt',displayTitle:'Japanese text',key:'/library/streams/11.srt'},{id:'13',streamType:3,languageCode:'zho',language:'Chinese',codec:'srt',displayTitle:'Chinese text',key:'/library/streams/13.srt'}]}]}]};
const subtitle='1\n00:00:01,000 --> 00:01:00,000\n日本語の字幕：ひらがな・カタカナ・漢字\n中文字幕：简体與繁體\n';
// A language preference must not burn this earlier image track when matching text exists.
movie.Media[0].Part[0].Stream.unshift({id:'90',streamType:3,languageCode:'jpn',codec:'pgs',displayTitle:'Japanese image'});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    let switched=false,holdDecision=false,held=[],failLibrary=false;
    await page.addInitScript(()=>{
      if(!localStorage.getItem('fixture-seeded')){
        localStorage.setItem('fixture-seeded','yes');localStorage.setItem('tizenosplex.token','OWNER_TEST');localStorage.setItem('tizenosplex.accountToken','OWNER_TEST');localStorage.setItem('tizenosplex.server','http://192.168.1.99:32400');localStorage.setItem('tizenosplex.serverId','fixture-server');
      }
      let listener,state='NONE',url='',audio=2,text=5;
      window.mockCalls=[];window.failDirect=false;window.failHls=false;
      window.webapis={avplay:{
        open(value){url=value;state='IDLE';window.mockCalls.push({action:'open',hls:value.includes('start.m3u8')});},setDisplayRect(){},setDisplayMethod(){},setListener(value){listener=value;},
        prepareAsync(ok,bad){setTimeout(()=>{if((window.failDirect&&!url.includes('start.m3u8'))||(window.failHls&&url.includes('directStream=1'))){bad(new Error('Unsupported fixture codec'));return;}state='READY';ok();},10);},
        getDuration(){return 3600000;},play(){state='PLAYING';window.mockCalls.push({action:'play'});},pause(){state='PAUSED';},seekTo(ms,ok){window.mockCalls.push({action:'seek',ms});setTimeout(ok,10);},stop(){state='IDLE';window.mockCalls.push({action:'stop'});},close(){state='NONE';},getVersion(){return 'MOCK';},
        getTotalTrackInfo(){return [{type:'AUDIO',index:2,extra_info:'{"language":"eng"}'},{type:'AUDIO',index:7,extra_info:'{"language":"jpn"}'},{type:'TEXT',index:5,extra_info:'{"track_lang":"eng"}'}];},getCurrentStreamInfo(){return [{type:'AUDIO',index:audio},{type:'TEXT',index:text}];},
        setSelectTrack(type,index){if(type==='AUDIO')audio=index;else text=index;window.mockCalls.push({action:'track',type,index});},setSilentSubtitle(){},setSubtitlePosition(){}
      },appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
    });
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS'};
    await page.route('https://plex.tv/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
      if(url.pathname==='/api/v2/resources'){
        const child=request.headers()['x-plex-token']==='CHILD_TEST';
        await route.fulfill({json:[{provides:'server',name:'Home fixture',clientIdentifier:'fixture-server',accessToken:child?'CHILD_SERVER_TEST':'OWNER_SERVER_TEST',connections:[{local:true,uri:'http://192.168.1.20:32400'}]}],headers});
      }else if(url.pathname==='/api/home/users'){
        await route.fulfill({body:'<MediaContainer><User id="1" title="Parent" protected="1"/><User id="2" title="Child" restricted="1" protected="0"/></MediaContainer>',contentType:'application/xml',headers});
      }else if(url.pathname.includes('/switch')){
        assert.equal(url.searchParams.has('pin'),false,'PIN must not be put in the URL');
        const child=url.pathname.includes('/2/');
        if(!child&&request.postData()!=='pin=1234'){await route.fulfill({status:403,body:'Denied',headers});return;}
        switched=child;await route.fulfill({body:'<user authenticationToken="'+(child?'CHILD_TEST':'OWNER_TEST')+'"/>',contentType:'application/xml',headers});
      }else await route.fulfill({status:404,body:'Unknown cloud endpoint',headers});
    });
    await page.route('http://192.168.1.99:32400/**',route=>route.abort());
    await page.route('http://192.168.1.20:32400/**',async route=>{
      const request=route.request(),url=new URL(request.url()),p=url.pathname;
      if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
      requests.push({path:p,params:Object.fromEntries(url.searchParams),token:request.headers()['x-plex-token'],method:request.method()});
      if(p==='/identity'){assert.equal(request.headers()['x-plex-token'],undefined);await route.fulfill({json:{MediaContainer:{machineIdentifier:'fixture-server'}},headers});return;}
      if(switched&&p!=='/identity')assert.equal(request.headers()['x-plex-token'],'CHILD_SERVER_TEST','Child must never use owner credentials');
      if(p.includes('/universal/decision')){
        if(holdDecision){held.push(route);return;}
        await route.fulfill({json:{MediaContainer:{generalDecisionCode:1000,Metadata:[{Media:[{videoDecision:url.searchParams.get('directStream')==='1'?'copy':'transcode',audioDecision:'transcode'}]}]}},headers});return;
      }
      if(p.includes('/indexes/sd/')){await route.fulfill({status:404,body:'No thumbnail',headers});return;}
      if(p.includes('/streams/')){await route.fulfill({body:subtitle,contentType:'text/plain; charset=utf-8',headers});return;}
      let box={};
      if(p==='/transcode/sessions')box={TranscodeSession:[{key:'another-client',audioCodec:'PRIVATE_OTHER_SESSION'},{key:requests.filter(r=>r.path.includes('/universal/decision')).slice(-1)[0].params.session,videoDecision:'transcode',audioDecision:'transcode',videoCodec:'h264',audioCodec:'aac'}]};
      else if(p==='/library/sections'){
        if(failLibrary){await route.fulfill({status:503,body:'Unavailable',headers});return;}
        box={Directory:[{key:switched?'2':'1',type:'movie',title:switched?'Kids movies':'Movies'}]};
      }else if(p.endsWith('/genre'))box={Directory:[{key:'3',title:'Animation'}]};
      else if(p.endsWith('/year'))box={Directory:[{key:'2024',title:'2024'}]};
      else if(p.includes('/metadata/'))box={Metadata:[movie]};
      else if(p.includes('/all')||p.includes('continueWatching'))box={Metadata:[movie],size:1,totalSize:1};
      await route.fulfill({json:{MediaContainer:box},headers});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await page.locator('.card').first().waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.session')).server),'http://192.168.1.20:32400');
    assert.ok(requests.some(r=>r.path==='/library/sections'&&r.token==='OWNER_SERVER_TEST'));
    await page.getByRole('button',{name:'Search / Filter',exact:true}).click();
    await page.getByLabel('Title contains').fill('日本語 & Example Film');
    await page.getByLabel('Sort',{exact:true}).selectOption('addedAt:desc');
    await page.getByLabel('Watch status').selectOption('unwatched');
    await page.getByLabel('Genre',{exact:true}).selectOption('3');
    await page.getByRole('button',{name:'Show results',exact:true}).click();
    await page.locator('.card').first().waitFor();
    const search=requests.find(r=>r.path.endsWith('/all')&&r.params.title);assert.equal(search.params.title,'日本語 & Example Film');assert.equal(search.params.genre,'3');assert.equal(search.params.unwatched,'1');
    await page.reload();await page.locator('.card').first().waitFor();
    await page.getByRole('button',{name:'Movies',exact:true}).click();await page.locator('.card').first().waitFor();
    const restored=requests.filter(r=>r.path.endsWith('/all')).slice(-1)[0];assert.equal(restored.params.title,'日本語 & Example Film');assert.equal(restored.params.sort,'addedAt:desc');assert.equal(restored.params.genre,'3');
    await page.getByRole('button',{name:'Search / Filter',exact:true}).click();assert.equal(await page.getByLabel('Title contains').inputValue(),'日本語 & Example Film');
    await page.getByRole('button',{name:'Show results',exact:true}).click();await page.locator('.card').first().waitFor();
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.locator('.card').first().waitFor();
    const cleared=requests.filter(r=>r.path.endsWith('/all')).slice(-1)[0];assert.equal(cleared.params.title,undefined);assert.equal(cleared.params.sort,'titleSort:asc');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Playback & languages',exact:true}).click();
    await page.getByLabel('Preferred audio',{exact:true}).selectOption('ja');
    await page.getByLabel('Preferred subtitles',{exact:true}).selectOption('ja');
    await page.getByLabel('When to show subtitles').selectOption('always');
    await page.getByRole('button',{name:'Back to settings',exact:true}).click();
    await page.getByRole('button',{name:'Subtitles & accessibility',exact:true}).click();
    await page.getByLabel('Subtitle size',{exact:true}).selectOption('80');
    await page.getByLabel('Subtitle background',{exact:true}).selectOption('solid');
    await page.getByLabel('Subtitle color',{exact:true}).selectOption('yellow');
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:path.join(out,'accessibility-cjk.png')});
    await page.getByLabel('Subtitle size',{exact:true}).focus();await page.keyboard.press('Enter');
    await page.getByRole('dialog').getByRole('button',{name:'64 px',exact:true}).click();
    assert.equal(await page.locator('#setting-subtitle-size').inputValue(),'64');
    await page.reload();await page.locator('.card').first().waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.preferences.owner')).subtitleSize),64);
    await page.locator('.card').first().click();await page.getByRole('button',{name:'Resume at 0:20'}).click();
    await page.waitForFunction(()=>window.mockCalls.some(c=>c.action==='play'));
    const openCount=await page.evaluate(()=>window.mockCalls.filter(c=>c.action==='open').length);
    await page.evaluate(()=>Array.prototype.find.call(document.querySelectorAll('button'),b=>b.textContent==='Play from beginning').click());
    assert.equal(await page.evaluate(()=>window.mockCalls.filter(c=>c.action==='open').length),openCount,'Duplicate Play must not replace an active attempt');
    await page.waitForFunction(()=>document.getElementById('subtitle-text').textContent.includes('日本語'));
    assert.equal(await page.evaluate(()=>window.mockCalls.find(c=>c.action==='open').hls),false,'Preferred text subtitles keep original playback');
    assert.ok(await page.evaluate(()=>window.mockCalls.some(c=>c.action==='track'&&c.type==='AUDIO'&&c.index===7)));
    assert.equal(await page.locator('#subtitle-text').evaluate(n=>getComputedStyle(n).fontSize),'64px');
    await page.screenshot({path:path.join(out,'japanese-chinese-subtitles.png')});
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Subtitle style',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/Timing:/}).click();
    await page.getByRole('button',{name:'Later by 0.5 seconds',exact:true}).click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.preferences.owner')).subtitleDelay),500);
    const seeksBefore=await page.evaluate(()=>window.mockCalls.filter(c=>c.action==='seek').length);
    await dismissMenus(page);await page.getByRole('button',{name:'Timeline',exact:true}).click();
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(()=>window.mockCalls.filter(c=>c.action==='seek').length),seeksBefore);
    await page.screenshot({path:path.join(out,'timeline-scrubber.png')});
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.mockCalls.filter(c=>c.action==='seek').length),seeksBefore);
    await dismissMenus(page);await page.getByRole('button',{name:'Timeline',exact:true}).click();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.mockCalls.some(c=>c.action==='seek'&&c.ms===30000));
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();await page.getByRole('button',{name:'Resume at 0:20'}).waitFor();
    await page.evaluate(()=>{window.failDirect=true;window.failHls=true;});
    await page.getByRole('button',{name:'Play from beginning',exact:true}).click();
    await page.waitForFunction(()=>window.mockCalls.filter(c=>c.action==='play').length>=2);
    await page.waitForFunction(()=>document.getElementById('playback-context').textContent.includes('Audio: Japanese'));
    assert.match(await page.locator('#playback-context').textContent(),/min remaining/,'Conversion retains current-time context and TV-reported selected audio');
    const decisions=requests.filter(r=>r.path.includes('/universal/decision'));
    assert.deepEqual(decisions.map(r=>r.params.directStream),['1','0']);
    assert.notEqual(decisions[0].params.session,decisions[1].params.session);
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Playback info',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.playback-information').textContent.includes('Server audio: transcode · aac'));
    assert.equal((await page.getByRole('dialog').textContent()).includes('PRIVATE_OTHER_SESSION'),false);
    await page.keyboard.press('Escape');
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();await page.getByRole('button',{name:'Resume at 0:20'}).waitFor();
    assert.ok(requests.some(r=>r.path.includes('/universal/stop')));
    holdDecision=true;
    await page.getByRole('button',{name:'Play from beginning',exact:true}).click();
    await page.waitForTimeout(300);
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();await page.getByRole('button',{name:'Resume at 0:20'}).waitFor();
    const playsBefore=await page.evaluate(()=>window.mockCalls.filter(c=>c.action==='play').length);
    for(const route of held)await route.fulfill({json:{MediaContainer:{generalDecisionCode:1000}},headers}).catch(()=>{});
    await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.mockCalls.filter(c=>c.action==='play').length),playsBefore);
    holdDecision=false;
    // Real AVPlay may expose an empty track list just after playback starts.
    movie.Media[0].Part[0].Stream=[{id:'20',streamType:2,codec:'aac',languageCode:'jpn'},{id:'21',index:2,streamType:3,codec:'srt',languageCode:'jpn'}];
    await page.reload();await page.locator('.card').first().click();
    await page.evaluate(()=>{const until=Date.now()+600;webapis.avplay.getTotalTrackInfo=()=>Date.now()<until?[]:[{type:'AUDIO',index:7,extra_info:'{"language":"jpn"}'},{type:'TEXT',index:5,extra_info:'{"track_lang":"jp  "}'}];});
    const beforeLateMetadata=requests.filter(r=>r.path.includes('/universal/decision')).length;
    await page.getByRole('button',{name:'Play from beginning',exact:true}).click();
    await page.waitForFunction(()=>window.mockCalls.some(c=>c.action==='track'&&c.type==='TEXT'&&c.index===5));
    assert.equal(requests.filter(r=>r.path.includes('/universal/decision')).length,beforeLateMetadata,'Late native metadata must not force transcoding');
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();
    // A DTS-only file with PGS subtitles must go directly to one burn session,
    // not prepare a doomed direct/remux pass or offer ineffective CSS controls.
    movie.Media[0].audioCodec='dca';
    movie.Media[0].Part[0].Stream=[{id:'20',streamType:2,codec:'dca',languageCode:'jpn'},{id:'21',streamType:3,codec:'pgs',languageCode:'jpn',selected:true}];
    await page.reload();await page.locator('.card').first().click();
    const decisionsBeforeBurn=requests.filter(r=>r.path.includes('/universal/decision')).length;
    await page.getByRole('button',{name:'Play from beginning',exact:true}).click();
    await page.waitForFunction(()=>window.mockCalls.some(c=>c.action==='play'));
    const burnDecisions=requests.filter(r=>r.path.includes('/universal/decision')).slice(decisionsBeforeBurn);
    assert.equal(burnDecisions.length,1);assert.equal(burnDecisions[0].params.subtitles,'burn');assert.equal(burnDecisions[0].params.directStream,'0');
    await page.waitForFunction(()=>/Subtitles: Japanese.*\(in video\)/.test(document.getElementById('playback-context').textContent));
    assert.doesNotMatch(await page.locator('#playback-context').textContent(),/Subtitles: Off/,'Native subtitle suppression must not label burned subtitles as off');
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Subtitle style',exact:true}).click();
    assert.match(await page.locator('#toast').textContent(),/rendered into the video/);
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();
    await page.getByRole('button',{name:'Profiles',exact:true}).click();
    await page.getByRole('button',{name:'Child',exact:true}).click();await page.getByRole('button',{name:'Switch profile',exact:true}).click();
    await page.getByRole('button',{name:'Kids movies',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Movies',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.session')).userToken),'CHILD_TEST');
    await page.reload();await page.getByRole('button',{name:'Kids movies',exact:true}).waitFor();
    await page.getByRole('button',{name:'Child',exact:true}).click();
    await page.getByRole('button',{name:'Parent · PIN required',exact:true}).click();
    await page.getByLabel('Plex Home PIN').fill('9999');await page.getByRole('button',{name:'Switch profile',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('rejected'));
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.session')).profile.id),'2');
    assert.equal(await page.getByLabel('Plex Home PIN').inputValue(),'');
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/pin/i.test(k))),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: server rediscovery, scoped credentials, search/filter encoding, per-profile language and accessibility preferences, CJK text, subtitle delay, scrub commit/cancel, fallback order/cleanup/cancellation, Home profile isolation and rejected PIN.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
