'use strict';
async function dismissMenus(page){for(let i=0;i<8&&await page.locator('#playback-menu').isVisible();i++)await page.keyboard.press('Escape');}
// Synthetic local fixtures only. These checks never connect to a TV or Plex account.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../app');
const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'*'};
const movie = {ratingKey:'42',type:'movie',title:'日本語の映画 · 中文电影',year:2026,duration:600000,viewOffset:120000,
  summary:'A synthetic description with enough detail to exercise remote-accessible expansion. '.repeat(30),
  thumb:'/library/metadata/42/thumb',Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{key:'/library/parts/42/file.mp4'}]}]};
const episode = {...movie,ratingKey:'43',type:'episode',title:'Hidden episode title',grandparentTitle:'Fixture series',
  grandparentThumb:'/library/metadata/1/thumb',grandparentRatingKey:'1',parentIndex:1,index:1};
const server = http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://test').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const mime={'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
  res.setHeader('Content-Type',mime[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});
async function fits(page, selector) {
  const bad=await page.locator(selector).evaluateAll(nodes=>nodes.filter(n=>{
    const r=n.getBoundingClientRect();return r.width&&r.height&&(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1);
  }).map(n=>n.id||n.className));
  assert.deepEqual(bad,[],selector+' fits the screen');
}
async function button(page,name){if(name==='More')await dismissMenus(page);await page.getByRole('button',{name,exact:true}).click();}
(async()=>{
  fs.mkdirSync(path.resolve('test-results'),{recursive:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tizenosplex.token','UI_FIXTURE_ONLY');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','fixture');
      let listener;window.seeks=[];window.stops=0;
      window.webapis={avplay:{open(){},setDisplayRect(){},setDisplayMethod(){},setListener(v){listener=v;},prepareAsync(ok){setTimeout(ok,10);},getDuration(){return 600000;},play(){},pause(){},
        seekTo(ms,ok){window.seeks.push(ms);setTimeout(ok,40);},stop(){window.stops++;},close(){},getTotalTrackInfo(){return [];},getCurrentStreamInfo(){return [];},setSilentSubtitle(){}},
        appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
    });
    await page.route('https://plex.tv/**',route=>{throw new Error('Unexpected cloud request: '+new URL(route.request().url()).pathname);});
    await page.route('http://192.168.1.20:32400/**',async route=>{
      const u=new URL(route.request().url()),p=u.pathname;
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      requests.push(p);
      if(p==='/photo/:/transcode')return route.fulfill({headers,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#496345"/><rect x="8" y="8" width="304" height="464" fill="none" stroke="#c4f184" stroke-width="8"/></svg>'});
      const all=[movie,episode,...Array.from({length:10},(_,i)=>({...movie,ratingKey:String(50+i),title:'Fixture film '+i}))];
      let box=p==='/library/sections'?{Directory:[{key:'1',title:'Films',type:'movie'}]}:
        p.includes('/metadata/')?{Metadata:[p.includes('/43')?episode:movie]}:
        u.searchParams.has('title')?{Metadata:[],totalSize:0}:{Metadata:all,totalSize:12};
      await route.fulfill({json:{MediaContainer:box},headers});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await page.locator('[data-home-focus="continue:0"]').waitFor();
    assert.equal(await page.locator('.home-grid').first().locator('.card').count(),9);
    assert.equal(await page.locator('.card-remaining').first().textContent(),'8 min left');
    assert.equal(await page.locator('.card-progress-fill').first().evaluate(n=>n.style.width),'20%');
    const poster=await page.locator('.poster').first().boundingBox();assert.ok(Math.abs(poster.height/poster.width-1.5)<0.02);
    assert.equal(await page.locator('nav').getByRole('button',{name:'Refresh',exact:true}).count(),0);
    assert.equal(await page.locator('nav').getByRole('button',{name:'Diagnostics',exact:true}).count(),0);
    assert.ok(poster.y<420,'Content and the fixed focused-title area fit without a redundant Home heading');
    await page.screenshot({path:path.resolve('test-results/ui-home-1920.png')});

    await button(page,'Films');await page.locator('[data-library-index="0"]').waitFor();
    await button(page,'Settings');await button(page,'Playback & languages');
    await page.keyboard.press('Escape');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Playback & languages');
    await button(page,'Connection settings');await button(page,'Enter server address manually');
    await page.locator('#server-address').fill('http://192.168.1.99:32400');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#server-address').count(),0);
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Connection settings');
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.server')),'http://192.168.1.20:32400','Cancelling manual setup must preserve the working connection');
    await button(page,'Subtitles & accessibility');
    await page.getByLabel('Interface text',{exact:true}).selectOption('large');
    for(const viewport of [{width:3840,height:2160},{width:1920,height:1080},{width:1280,height:720},{width:1024,height:768}]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(()=>Math.abs(document.getElementById('ui-root').getBoundingClientRect().width-1920*Math.min(innerWidth/1920,innerHeight/1080))<1);
      await fits(page,'#shell,#main,.accessibility-layout');
      await page.locator('#setting-subtitle-size').focus();await page.keyboard.press('Enter');
      await fits(page,'#playback-menu,.playback-menu-panel');
      await page.getByRole('dialog').getByRole('button',{name:'96 px',exact:true}).focus();
      await fits(page,'#playback-menu-options button:focus');
      await page.screenshot({path:path.resolve('test-results/ui-dialog-'+viewport.width+'.png')});
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'setting-subtitle-size');
    }
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Subtitles & accessibility');
    await page.keyboard.press('Escape');await page.locator('[data-library-index="0"]').waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Settings');
    const columns=await page.locator('.library-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length);assert.equal(columns,9);
    await page.locator('[data-library-index="0"]').click();
    await page.getByRole('button',{name:'Read more',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Resume at 2:00');
    await page.getByRole('button',{name:'Read more',exact:true}).focus();await page.keyboard.press('Enter');
    await page.locator('.description-text').waitFor();await page.keyboard.press('ArrowDown');assert.ok(await page.locator('.description-text').evaluate(n=>n.scrollTop)>0);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Read more');
    await button(page,'Settings');await button(page,'Diagnostics');await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Diagnostics');
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'Resume at 2:00',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Settings');

    await button(page,'Resume at 2:00');await page.waitForFunction(()=>window.seeks.length>0);await page.waitForTimeout(80);
    await page.setViewportSize({width:3840,height:2160});
    await page.waitForFunction(()=>document.getElementById('ui-root').getBoundingClientRect().width===3840);
    await fits(page,'#player-ui,#player-controls');
    await fits(page,'#player-buttons button:not([hidden])');
    await button(page,'Pause');assert.equal(await page.locator('#control-toggle').textContent(),'Play');await button(page,'Play');
    const count=await page.evaluate(()=>window.seeks.length);
    await page.keyboard.press('Escape');await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'130000');
    assert.equal(await page.evaluate(()=>window.seeks.length),count,'Directional preview must not move playback');
    await fits(page,'#playback-menu,.playback-menu-panel,.scrub-visual');
    await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:39,repeat:true,bubbles:true})));
    assert.equal(await page.evaluate(()=>window.seeks.length),count,'Held keys must not flood AVPlay');
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.seeks.length),count,'Back cancels the staged jump');
    await page.keyboard.press('Escape');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.seeks.includes(130000));await page.waitForTimeout(80);
    await button(page,'More');await button(page,'Subtitle style');await page.getByRole('button',{name:/Size:/}).click();
    await fits(page,'#playback-menu,.playback-menu-panel');await page.keyboard.press('Escape');
    assert.match(await page.evaluate(()=>document.activeElement.textContent),/^Size:/);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Subtitle style');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'control-more');
    await button(page,'More');await button(page,'Stop');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Keep watching');
    const stops=await page.evaluate(()=>window.stops);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.stops),stops);
    await button(page,'More');await button(page,'Stop');await button(page,'Stop playback');
    await page.getByRole('button',{name:'Resume at 2:00',exact:true}).waitFor();
    await button(page,'Films');await button(page,'Search / Filter');await page.getByLabel('Title contains').fill('No such fixture');await button(page,'Show results');
    await page.getByRole('heading',{name:'No matching titles'}).waitFor();assert.equal(await page.getByText(/scanned this library/).count(),0);
    await button(page,'Edit filters');assert.equal(await page.getByLabel('Title contains').inputValue(),'No such fixture');await page.keyboard.press('Escape');
    await button(page,'Clear filters');await page.locator('[data-library-index="0"]').waitFor();
    await page.locator('[data-library-index="1"]').click();await page.getByRole('button',{name:'Show language preferences'}).waitFor();
    await button(page,'Show language preferences');await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement.textContent==='Show language preferences');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Show language preferences');
    await button(page,'Reveal episode details');
    assert.equal(await page.locator('.detail-poster.episode-still').count(),1);
    const onboarding=await browser.newPage({viewport:{width:1280,height:720}});
    await onboarding.route('https://plex.tv/**',route=>route.fulfill({headers,json:{id:12,code:'ABCD',expiresIn:300}}));
    await onboarding.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    assert.equal(await onboarding.locator('#server-address').count(),0);
    assert.equal(await onboarding.evaluate(()=>document.activeElement.textContent),'Link Plex and find server');
    await button(onboarding,'Link Plex and find server');await onboarding.getByText('ABCD',{exact:true}).waitFor();
    await fits(onboarding,'.panel,.code');
    await onboarding.keyboard.press('Escape');
    assert.equal(await onboarding.evaluate(()=>document.activeElement.textContent),'Link Plex and find server');
    await onboarding.close();
    assert.deepEqual(errors,[]);
    console.log('PASS: parent/focus restoration, scaled dialogs/player/CJK accessibility, six columns, poster ratios, Continue Watching progress, repeated seek and held-key guard, accurate pause labels, safe More/Stop, Read more, spoiler reveal and filtered-empty recovery.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
