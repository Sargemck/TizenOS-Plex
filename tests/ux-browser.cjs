'use strict';
// Remote-first checks with synthetic Plex/AVPlay fixtures. Never contacts a TV.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'../app');
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS'};
const longTitle='日本語の映画・中文电影・ひらがなとカタカナ — A long but readable synthetic film title';
const movie={ratingKey:'42',type:'movie',title:longTitle,year:2026,duration:600000,viewOffset:120000,thumb:'/library/metadata/42/thumb',
  summary:('Beginning 日本語の説明。中文说明，简体与繁體。 A complete description must be readable using only the remote.\n').repeat(50)+'THE END 終わり 结束',
  Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{id:'80',key:'/library/parts/80/file.mp4',Stream:[
    {id:'10',streamType:2,codec:'aac',languageCode:'eng'},
    {id:'11',streamType:3,codec:'srt',languageCode:'eng'},
    {id:'12',streamType:3,codec:'srt',languageCode:'jpn',displayTitle:'Japanese external',key:'/library/streams/12.srt'}]}]}]};
const episode={...movie,ratingKey:'43',type:'episode',title:'Hidden episode title',grandparentTitle:'日本語シリーズ',grandparentThumb:'/library/metadata/30/thumb',grandparentRatingKey:'30',parentIndex:1,index:2,viewOffset:0};
const watchedEpisode={...episode,ratingKey:'44',title:'Watched episode',index:3,viewCount:1};
const films=[movie,...Array.from({length:11},(_,i)=>({...movie,ratingKey:String(50+i),title:'Synthetic film '+i}))];
const mixed=[movie,episode,watchedEpisode,...films.slice(1,4)];
const server=http.createServer((req,res)=>{
  const file=path.join(app,new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(app+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const types={'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
  res.setHeader('Content-Type',types[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});
async function activate(page,name,scope=page){await scope.getByRole('button',{name,exact:true}).focus();await page.keyboard.press('Enter');}
async function focused(page){return page.evaluate(()=>document.activeElement.textContent);}
async function selectMenu(page,name){
  for(let i=0;i<20;i++){
    if(await focused(page)===name){await page.keyboard.press('Enter');return;}
    await page.keyboard.press('ArrowDown');
  }
  throw Error('Remote could not reach menu choice '+name+'; available: '+await page.locator('#playback-menu-options').textContent());
}
async function ringFits(page){
  const failures=await page.evaluate(()=>{
    const node=document.activeElement,r=node.getBoundingClientRect(),style=getComputedStyle(node);
    const scale=document.getElementById('ui-root').getBoundingClientRect().width/1920;
    const extension=(parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset))*scale;
    const ring={left:r.left-extension,right:r.right+extension,top:r.top-extension,bottom:r.bottom+extension};
    const errors=[];
    if(ring.left<-.5||ring.top<-.5||ring.right>innerWidth+.5||ring.bottom>innerHeight+.5)errors.push('viewport');
    for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement){
      const s=getComputedStyle(ancestor),b=ancestor.getBoundingClientRect();
      if(/hidden|auto|scroll|clip/.test(s.overflowX)&&(ring.left<b.left-.5||ring.right>b.right+.5))errors.push(ancestor.id+' x');
      if(/hidden|auto|scroll|clip/.test(s.overflowY)&&(ring.top<b.top-.5||ring.bottom>b.bottom+.5))errors.push(ancestor.id+' y');
    }
    return errors;
  });
  assert.deepEqual(failures,[],'Full focus outline must fit every clipping ancestor');
}
(async()=>{
  fs.mkdirSync(path.resolve('test-results'),{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tizenosplex.token','SYNTHETIC_UX_ONLY');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','ux-fixture');
      window.mock={opens:0,stops:0,audio:2,text:5,unknown:false};
      window.webapis={avplay:{open(){mock.opens++;},setDisplayRect(){},setDisplayMethod(){},setListener(value){mock.listener=value;},prepareAsync(ok){setTimeout(ok,80);},getDuration(){return 600000;},
        play(){},pause(){},seekTo(ms,ok){setTimeout(ok,10);},stop(){mock.stops++;},close(){},
        getTotalTrackInfo(){return mock.unknown?[]:[{type:'AUDIO',index:2,extra_info:'{"language":"eng","fourCC":"AAC","channels":2}'},{type:'AUDIO',index:7,extra_info:'{"language":"jpn"}'},{type:'TEXT',index:5,extra_info:'{"track_lang":"eng"}'}];},
        getCurrentStreamInfo(){return mock.unknown?[]:[{type:'AUDIO',index:mock.audio},{type:'TEXT',index:mock.text}];},setSelectTrack(type,index){mock[type==='AUDIO'?'audio':'text']=index;},setSilentSubtitle(){},setSubtitlePosition(){}},
        appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
    });
    await page.route('https://plex.tv/**',route=>route.abort());
    await page.route('http://192.168.1.20:32400/**',async route=>{
      const u=new URL(route.request().url()),p=u.pathname;
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      requests.push(p);
      if(p==='/photo/:/transcode')return route.fulfill({headers,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#496345"/></svg>'});
      if(p==='/library/streams/12.srt')return route.fulfill({headers,body:'1\n00:00:00,000 --> 00:10:00,000\n日本語の字幕\n'});
      if(p==='/:/timeline')return route.fulfill({headers,status:200,body:''});
      let box;
      if(p==='/library/sections')box={Directory:[{key:'1',title:'Films',type:'movie'},{key:'2',title:'TV Series',type:'show'}]};
      else if(p==='/library/sections/2/all')box={Metadata:[{ratingKey:'30',type:'show',title:'日本語シリーズ'}],totalSize:1};
      else if(p==='/library/metadata/30')box={Metadata:[{ratingKey:'30',type:'show',title:'日本語シリーズ',OnDeck:{Metadata:[episode]}}]};
      else if(p==='/library/metadata/30/children')box={Metadata:[{ratingKey:'31',parentRatingKey:'30',type:'season',title:'Season 1'}],totalSize:1};
      else if(p==='/library/metadata/31/children')box={Metadata:[episode,watchedEpisode,...Array.from({length:10},(_,i)=>({...episode,ratingKey:String(80+i),index:4+i}))],totalSize:12};
      else if(p.startsWith('/library/metadata/')){await new Promise(resolve=>setTimeout(resolve,150));box={Metadata:[p.includes('/43')?episode:movie]};}
      else box={Metadata:p==='/library/sections/1/all'?films:mixed,totalSize:p==='/library/sections/1/all'?12:6};
      await route.fulfill({headers,json:{MediaContainer:box}});
    });
    await page.goto(origin+'/index.html');await page.locator('[data-home-focus="continue:0"]').waitFor();
    await page.waitForTimeout(400); // let the independently deferred recently-added rows settle
    const homeGeometry=await page.locator('.home-grid').first().locator('.card').evaluateAll(cards=>cards.map(card=>{
      const poster=card.querySelector('.poster').getBoundingClientRect();return {ratio:poster.height/poster.width,titleY:card.querySelector('.card-title').getBoundingClientRect().y,height:card.getBoundingClientRect().height};
    }));
    assert.ok(homeGeometry.every(g=>Math.abs(g.ratio-1.5)<.02),'Mixed Home row uses portrait frames');
    assert.ok(homeGeometry.every(g=>Math.abs(g.titleY-homeGeometry[0].titleY)<1),'Mixed-row titles align');
    const requestCount=requests.length;
    await page.locator('[data-home-focus="continue:0"]').focus();
    assert.equal(await page.locator('#focused-title').textContent(),longTitle);
    assert.match(await page.locator('#focused-meta').textContent(),/2026.*In progress/);
    const gridTop=await page.locator('.home-grid').first().evaluate(n=>n.getBoundingClientRect().top);
    for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');
    for(let i=0;i<4;i++)await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#focused-title').textContent(),'S1 · E2');
    assert.doesNotMatch(await page.locator('#focused-title').textContent(),/Hidden episode title/);
    assert.match(await page.locator('#focused-meta').textContent(),/日本語シリーズ/);
    assert.equal(await page.locator('.home-grid').first().evaluate(n=>n.getBoundingClientRect().top),gridTop,'Focus text does not move grid');
    assert.equal(requests.length,requestCount,'Focus movement issues no requests');

    for(const large of [false,true]){
      await activate(page,'Settings');await activate(page,'Subtitles & accessibility');
      await page.getByLabel('Interface text',{exact:true}).selectOption(large?'large':'normal');
      await page.keyboard.press('Escape');await page.keyboard.press('Escape');
      for(const size of [{width:1920,height:1080},{width:1280,height:720}]){
        await page.setViewportSize(size);await page.waitForTimeout(50);
        for(const button of await page.locator('#navigation button').all()){await button.focus();await ringFits(page);}
      }
    }
    await page.setViewportSize({width:1920,height:1080});
    await activate(page,'TV Series');await page.locator('[data-library-index="0"]').focus();await page.keyboard.press('Enter');
    await activate(page,'Seasons & episodes');await page.locator('[data-library-index="0"]').focus();await page.keyboard.press('Enter');
    await page.locator('.library-grid .episode-still').first().waitFor();
    const episodeGeometry=await page.locator('.library-grid .card').evaluateAll(cards=>cards.map(card=>{
      const p=card.querySelector('.poster').getBoundingClientRect();return {ratio:p.height/p.width,height:card.getBoundingClientRect().height};
    }));
    assert.ok(episodeGeometry.every(g=>Math.abs(g.ratio-.5625)<.02),'Protected and watched episodes have matching landscape frames');
    assert.ok(episodeGeometry[0].height<homeGeometry[0].height-100,'Episode rows are substantially shorter');

    await activate(page,'Films');await page.locator('[data-library-index="0"]').focus();
    const beforeDetails=requests.filter(p=>p==='/library/metadata/42').length;
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#main').getAttribute('aria-busy'),'true');
    assert.equal(await page.locator('#main h1').textContent(),'Opening title…','Slow title requests have specific immediate feedback');
    await page.keyboard.press('Enter');
    await page.evaluate(()=>{for(let i=0;i<12;i++)document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13,repeat:true,bubbles:true}));});
    await page.getByRole('button',{name:'Read more',exact:true}).waitFor();
    assert.equal(requests.filter(p=>p==='/library/metadata/42').length,beforeDetails+1,'Held OK opens one detail request');
    // From the automatically focused Resume action, remote navigation alone opens
    // and reads the full description. No mouse click or scroll API is involved.
    await page.keyboard.press('ArrowDown');
    if(await focused(page)==='Save for later')await page.keyboard.press('ArrowLeft');
    if(await focused(page)==='Technical details')await page.keyboard.press('ArrowUp');
    assert.equal(await focused(page),'Read more');
    const detailScroll=await page.locator('#main').evaluate(n=>n.scrollTop);
    await page.keyboard.press('Enter');await page.locator('.description-text').waitFor();
    assert.equal(await page.locator('.description-text').evaluate(n=>n===document.activeElement),true);
    await ringFits(page);
    for(let i=0;i<80;i++)await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('.description-text').evaluate(n=>Math.abs(n.scrollHeight-n.clientHeight-n.scrollTop)<2),true,'Remote reaches the final line');
    await page.screenshot({path:path.resolve('test-results/ux-description-end.png')});
    for(let i=0;i<80;i++)await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('.description-text').evaluate(n=>n.scrollTop),0,'Remote returns to first line');
    await page.keyboard.press('Escape');assert.equal(await focused(page),'Read more');
    assert.equal(await page.locator('#main').evaluate(n=>n.scrollTop),detailScroll,'Description Back restores page position');

    await activate(page,'Resume at 2:00');
    await page.keyboard.press('Enter');
    await page.evaluate(()=>{for(let i=0;i<12;i++)document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13,repeat:true,bubbles:true}));});
    await page.waitForFunction(()=>document.getElementById('playback-context').textContent.includes('Audio: English'));
    assert.equal(await page.evaluate(()=>mock.opens),1,'Held OK starts one playback attempt');
    assert.match(await page.locator('#playback-context').textContent(),/8 min remaining.*Audio: English.*Subtitles: English/);
    await page.evaluate(()=>mock.listener.oncurrentplaytime(300000));
    assert.match(await page.locator('#playback-context').textContent(),/^5 min remaining/);
    await page.locator('#control-toggle').focus();await page.keyboard.down('Enter');
    assert.equal(await page.locator('#control-toggle').evaluate(n=>n.classList.contains('pressed')),true,'Activation has immediate visual feedback distinct from focus');
    await page.keyboard.up('Enter');assert.equal(await page.locator('#control-toggle').textContent(),'Play');
    assert.match(await page.locator('#playback-context').textContent(),/^5 min remaining/);
    await activate(page,'Play');
    await activate(page,'Forward');await selectMenu(page,'+1 minute');
    await page.waitForFunction(()=>document.getElementById('playback-context').textContent.startsWith('4 min remaining'));
    await activate(page,'More');await selectMenu(page,'Subtitle style');
    const oldSize=await focused(page);assert.match(oldSize,/Size:/);
    await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.equal(await focused(page),oldSize);
    await page.keyboard.press('Enter');await selectMenu(page,'80 px');
    assert.equal(await focused(page),'Size: 80 px','Selecting returns to updated parent choice');
    await page.screenshot({path:path.resolve('test-results/ux-parent-menu.png')});
    await page.keyboard.press('Escape');assert.equal(await focused(page),'Subtitle style');
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'control-more');
    assert.equal(await page.evaluate(()=>mock.stops),0,'Nested Back never stops playback');
    await activate(page,'Subtitles');await page.keyboard.press('ArrowUp');await selectMenu(page,'Subtitles off');
    assert.match(await page.locator('#playback-context').textContent(),/Subtitles: Off$/);
    await activate(page,'Subtitles');await selectMenu(page,'Japanese external · srt · Plex');
    await page.waitForFunction(()=>document.getElementById('playback-context').textContent.includes('Subtitles: Japanese external'));
    await activate(page,'Audio');await selectMenu(page,'Audio 2 · Japanese');
    assert.match(await page.locator('#playback-context').textContent(),/Audio: Japanese/);
    await page.evaluate(()=>{mock.unknown=true;});await activate(page,'Pause');
    assert.equal(await page.locator('#control-toggle').textContent(),'Play','Pause completes before reading changed track metadata');
    assert.match(await page.locator('#playback-context').textContent(),/Audio: Not reported/);
    assert.match(await page.locator('#playback-context').textContent(),/Subtitles: Japanese external/,'External subtitles remain known when TV metadata is absent');
    await page.evaluate(()=>{mock.unknown=false;});await activate(page,'Subtitles');
    for(let i=0;i<10;i++)await page.keyboard.press('ArrowUp');
    await selectMenu(page,'Subtitle 1 · English · srt');
    await page.evaluate(()=>{mock.unknown=true;});await activate(page,'Play');
    assert.match(await page.locator('#playback-context').textContent(),/Audio: Not reported.*Subtitles: Not reported/,'Missing TV metadata is not misrepresented as a known language');
    assert.deepEqual(errors,[]);

    const pairing=await browser.newPage({viewport:{width:1280,height:720}}),cloud=[];
    let expiry=300;
    await pairing.route('https://plex.tv/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      cloud.push(p);await route.fulfill({headers,json:p==='/api/v2/pins'?{id:123,code:'ABCD',expiresIn:expiry}:{}});
    });
    const external=[];pairing.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('https://plex.tv/'))external.push(request.url());});
    await pairing.goto(origin+'/index.html');await pairing.keyboard.press('Enter');await pairing.getByText('ABCD',{exact:true}).waitFor();
    assert.equal(await pairing.locator('.pairing-layout svg').count(),1);
    await pairing.screenshot({path:path.resolve('test-results/ux-pairing.png')});
    await pairing.keyboard.press('Escape');assert.equal(await focused(pairing),'Link Plex and find server');
    const cancelledCount=cloud.length;await pairing.waitForTimeout(2150);
    assert.equal(cloud.length,cancelledCount,'Cancelled pairing does not poll or accept a later result');
    expiry=1;await pairing.keyboard.press('Enter');await pairing.getByText('ABCD',{exact:true}).waitFor();
    await pairing.getByText('This sign-in link has expired. Request a new one.',{exact:true}).waitFor();
    assert.equal(await pairing.locator('.pairing-layout svg').count(),0,'Expired code no longer shows a pairing QR');
    assert.deepEqual(external,[],'No third-party QR service or other external request');
    console.log('PASS: remote descriptions, focus outlines, row artwork, stable CJK focus information, nested playback menus, held activation, track context and pairing cancellation/expiry.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
