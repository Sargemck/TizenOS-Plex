'use strict';
async function dismissMenus(page){for(let i=0;i<8&&await page.locator('#playback-menu').isVisible();i++)await page.keyboard.press('Escape');}
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'../app');
const out=path.resolve(__dirname,'../test-results');fs.mkdirSync(out,{recursive:true});
const movie={ratingKey:'42',type:'movie',title:'The Long Weekend',year:2024,duration:600000,viewOffset:20000,summary:'A fixture title used to check navigation, playback controls and watch progress. No real Plex account is accessed.',Media:[{videoCodec:'h264',audioCodec:'aac',videoResolution:'1080',Part:[{key:'/library/parts/42/file.mp4'}]}]};
const items=Array.from({length:12},(_,i)=>({...movie,ratingKey:String(42+i),title:['The Long Weekend','Northern Lights','Quiet Water','Across the Valley','Last Train Home','The Observatory','Open Roads','Midnight Sun','The Garden','A Better Tomorrow','Winter Stories','Another Chapter'][i]}));
const timelines=[];let pinPolls=0,pageStarts=[],failLibrary=false;
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://test').pathname);
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined});
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      let listener, state='NONE', audioIndex=2, textIndex=11;
      window.mockCalls=[];
      window.webapis={avplay:{open(){state='IDLE';window.mockCalls.push('open');},setDisplayRect(){},setDisplayMethod(){},setListener(v){listener=v;},prepareAsync(ok){setTimeout(()=>{state='READY';ok();},10);},getDuration(){return 600000;},play(){state='PLAYING';window.mockCalls.push('play');listener.oncurrentplaytime(25000);},pause(){state='PAUSED';},seekTo(ms,ok){window.mockCalls.push('seek:'+ms);setTimeout(ok,10);},stop(){state='IDLE';window.mockCalls.push('stop');},close(){state='NONE';},getState(){return state;},getVersion(){return 'MOCK-AVPlay'},getTotalTrackInfo(){return window.mockNoTracks?[]:[{type:'AUDIO',index:2,extra_info:'{"language":"en","channels":"2","fourCC":"AAC"}'},{type:'AUDIO',index:7,extra_info:'{"language":"tr","channels":"6","fourCC":"AC3"}'},{type:'TEXT',index:11,extra_info:'{"track_lang":"eng"}'},{type:'TEXT',index:15,extra_info:'{"track_lang":"tur"}'}];},getCurrentStreamInfo(){return [{type:'AUDIO',index:audioIndex},{type:'TEXT',index:textIndex}];},setSelectTrack(type,index){if(type==='AUDIO')audioIndex=index;else textIndex=index;window.mockCalls.push(type+':'+index);},setSilentSubtitle(value){window.mockCalls.push('silent:'+value);}},appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
    });
    await page.route('https://plex.tv/**',async route=>{
      if (route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});return;}
      const url=new URL(route.request().url());
      const data=url.pathname==='/api/v2/resources'?[{provides:'server',name:'Fixture',clientIdentifier:'fixture-server',accessToken:'TEST_ONLY_TOKEN',connections:[{local:true,uri:'http://192.168.1.20:32400'}]}]:url.pathname==='/api/v2/pins'?{id:12,code:'ABCD',expiresIn:300}:{authToken:++pinPolls>0?'TEST_ONLY_TOKEN':''};
      await route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
    });
    await page.route('http://192.168.1.20:32400/**',async route=>{
      const url=new URL(route.request().url());const pathname=url.pathname;
      if (route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});return;}
      let box={};
      if(pathname==='/identity')box={machineIdentifier:'fixture-server'};
      else if(pathname==='/library/sections'){
        if(failLibrary){await route.fulfill({status:503,body:'unavailable',headers:{'access-control-allow-origin':'*'}});return;}
        box={Directory:[{key:'1',type:'movie',title:'Movies'},{key:'2',type:'show',title:'TV shows'}]};
      } else if(pathname.indexOf('/library/metadata/')===0)box={Metadata:[movie]};
      else if(pathname==='/:/timeline'){timelines.push(Object.fromEntries(url.searchParams));box={};}
      else {pageStarts.push(url.searchParams.get('X-Plex-Container-Start'));box={Metadata:items,totalSize:24,size:12};}
      await route.fulfill({json:{MediaContainer:box},headers:{'access-control-allow-origin':'*'}});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await page.getByRole('heading',{name:'Connect your Plex library'}).waitFor();
    await page.screenshot({path:path.join(out,'setup.png')});
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Link Plex and find server');
    await page.getByRole('button',{name:'Enter server address manually',exact:true}).click();
    await page.locator('#server-address').fill('http://localhost:32400');
    await page.getByRole('button',{name:'Save and link Plex'}).click();
    assert.match(await page.locator('#toast').textContent(),/network address/);
    await page.locator('#server-address').fill('http://192.168.1.20:32400');
    await page.getByRole('button',{name:'Save and link Plex'}).click();
    await page.getByText('ABCD',{exact:true}).waitFor();
    await page.locator('.card').first().waitFor();
    const savedClient=await page.evaluate(()=>localStorage.getItem('tizenosplex.client'));
    const pollsBeforeReload=pinPolls;
    await page.reload();
    await page.locator('.card').first().waitFor();
    assert.equal(pinPolls,pollsBeforeReload,'Restart should reuse the saved Plex sign-in');
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.server')),'http://192.168.1.20:32400');
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.client')),savedClient);
    await page.locator('#toast').evaluate(n=>n.hidden=true);
    await page.getByRole('button',{name:'Movies',exact:true}).click();
    await page.locator('[data-library-index="0"]').waitFor();
    await page.locator('[data-library-index="23"]').waitFor();
    assert.equal(await page.locator('.card').count(),24,'Fill both visible rows without a first scroll');
    await page.screenshot({path:path.join(out,'library.png')});
    const overflows=await page.locator('.card').evaluateAll(nodes=>nodes.some(n=>n.getBoundingClientRect().right>innerWidth));assert.equal(overflows,false);
    const start=await page.evaluate(()=>document.activeElement.textContent);
    await page.keyboard.press('ArrowRight');assert.notEqual(await page.evaluate(()=>document.activeElement.textContent),start);
    await page.locator('[data-library-index="6"]').focus();await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement.getAttribute('data-library-index')==='15');assert.ok(pageStarts.includes('12'));
    await page.locator('.card').first().click();
    await page.getByRole('button',{name:'Resume at 0:20'}).waitFor();
    await page.getByRole('button',{name:'Resume at 0:20'}).click();
    await page.waitForFunction(()=>window.mockCalls.includes('play')).catch(async error=>{
      console.error(await page.evaluate(()=>({calls:window.mockCalls,toast:document.getElementById('toast').textContent})));
      console.error(errors);
      throw error;
    });
    const menu=page.getByRole('dialog');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#player-controls').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.mockCalls.includes('stop')),false);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Keep watching');
    await page.keyboard.press('Enter');
    assert.equal(await menu.isVisible(),false);assert.equal(await page.locator('#player-controls').isVisible(),false);
    for(let i=0;i<6;i++)await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.mockCalls.includes('stop')),false,'Repeated Back must never confirm Stop');
    if(await menu.isVisible())await page.keyboard.press('Escape');
    if(!await page.locator('#player-controls').isVisible())await page.keyboard.press('Enter');

    await page.getByRole('button',{name:'Audio',exact:true}).click();
    assert.equal(await menu.getByRole('button',{name:/Audio 1.*English/}).getAttribute('aria-pressed'),'true');
    await page.screenshot({path:path.join(out,'audio-menu.png')});
    await page.waitForTimeout(7500);
    assert.equal(await menu.isVisible(),true,'Menu must stay open beyond controls auto-hide');
    await page.keyboard.press('ArrowDown');
    assert.match(await page.evaluate(()=>document.activeElement.textContent),/Audio 2.*Turkish/);
    await page.keyboard.press('Enter');
    assert.equal(await menu.isVisible(),false);
    assert.ok(await page.evaluate(()=>window.mockCalls.includes('AUDIO:7')));
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Audio');
    await page.getByRole('button',{name:'Audio',exact:true}).click();
    assert.equal(await menu.getByRole('button',{name:/Audio 2.*Turkish/}).getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.mockCalls.includes('stop')),false,'Back closes a menu without stopping');
    await page.getByRole('button',{name:'Subtitles',exact:true}).click();
    await page.screenshot({path:path.join(out,'subtitle-menu.png')});
    await menu.getByRole('button',{name:/Subtitle 2.*Turkish/}).click();
    assert.ok(await page.evaluate(()=>window.mockCalls.includes('TEXT:15')));
    assert.ok(await page.evaluate(()=>window.mockCalls.includes('silent:false')));
    await page.getByRole('button',{name:'Subtitles',exact:true}).click();
    await menu.getByRole('button',{name:'Subtitles off',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.mockCalls.includes('silent:true')));
    await page.getByRole('button',{name:'Subtitles',exact:true}).click();
    assert.equal(await menu.getByRole('button',{name:'Subtitles off',exact:true}).getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Escape');
    for (const [direction,label,target] of [['Forward','+10 seconds',30000],['Forward','+1 minute',90000],['Forward','+10 minutes',599000],['Backward','−10 seconds',589000],['Backward','−1 minute',529000],['Backward','−10 minutes',0]]) {
      await page.getByRole('button',{name:direction,exact:true}).click();
      if(label==='+10 minutes')await page.screenshot({path:path.join(out,'seek-menu.png')});
      await menu.getByRole('button',{name:label,exact:true}).click();
      await page.waitForFunction(ms=>window.mockCalls.includes('seek:'+ms),target);
      await page.waitForFunction(()=>!document.getElementById('player-message').textContent);
    }
    await page.evaluate(()=>window.mockNoTracks=true);
    await page.getByRole('button',{name:'Audio',exact:true}).click();
    assert.match(await menu.textContent(),/No audio tracks/);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.mockNoTracks=false);
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Audio',exact:true}).click();
    await menu.getByRole('button',{name:/Audio 1.*English/}).click();
    assert.equal(await menu.isVisible(),true,'A failed selection leaves the menu open');
    assert.match(await page.locator('#toast').textContent(),/Resume playback/);
    await page.keyboard.press('Escape');
    await dismissMenus(page);await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Stop playback',exact:true}).click();
    await page.getByRole('button',{name:'Resume at 0:20'}).waitFor();
    await page.waitForFunction(()=>document.getElementById('shell').hidden===false);
    assert.ok(timelines.some(t=>t.state==='playing'));assert.ok(timelines.some(t=>t.state==='stopped'));
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
    assert.equal((await page.locator('pre').textContent()).includes('TEST_ONLY_TOKEN'),false);
    failLibrary=true;
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.reload();
    await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
    failLibrary=false;
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.locator('.card').first().waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Connection settings',exact:true}).click();
    await page.getByRole('button',{name:'Sign out on this TV'}).click();
    await page.getByRole('button',{name:'Sign out and clear local data',exact:true}).click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.token')),null);
    assert.deepEqual(errors,[]);
    console.log('PASS: saved settings/restart, setup and PIN pairing, library navigation, resume, track lists and selection, subtitle off, modal focus/Back/auto-hide, empty and paused-track handling, six seek choices/clamping, pause, stop/timeline, redaction, retry and sign-out.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
