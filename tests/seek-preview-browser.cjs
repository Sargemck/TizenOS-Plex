'use strict';
// All Plex and AVPlay responses are synthetic; no TV or household server access.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'../app');
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'};
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
async function until(test){for(let n=0;n<100;n++){if(test())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Fixture response was not requested');}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try{
    async function fixture(options={}){
      const page=await browser.newPage({viewport:{width:1920,height:1080}}),requests=[],errors=[],unexpected=[],held=[];
      const state={hold:false,fail:false};
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(({previewImages,largeUI})=>{
        localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.token','PREVIEW_FIXTURE_ONLY');
        localStorage.setItem('tizenosplex.preferences.owner',JSON.stringify({subtitleMode:'off',previewImages,largeUI}));
        let listener;window.mockCalls=[];window.mockState='NONE';
        window.webapis={avplay:{open(){window.mockState='IDLE';},setDisplayRect(){},setDisplayMethod(){},setListener(value){listener=value;window.advanceFixture=time=>listener.oncurrentplaytime(time);},prepareAsync(ok){setTimeout(ok,5);},getDuration(){return 3600000;},
          play(){window.mockState='PLAYING';window.mockCalls.push({action:'play'});},pause(){window.mockState='PAUSED';window.mockCalls.push({action:'pause'});},stop(){window.mockState='IDLE';},close(){},
          seekTo(ms,ok){window.mockCalls.push({action:'seek',ms});setTimeout(ok,5);},getTotalTrackInfo(){return [];},getCurrentStreamInfo(){return [];},setSilentSubtitle(){},setSubtitlePosition(){}
        },appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
      },{previewImages:options.previewImages!==false,largeUI:!!options.largeUI});
      const movie={ratingKey:'42',type:'movie',title:'Seek fixture',duration:3600000,Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{id:'80',key:'/library/parts/80/file.mkv',indexes:options.indexes===false?'':'sd',Stream:[]}]}]};
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url()),p=url.pathname;
        if(url.hostname==='127.0.0.1')return route.continue();
        if(url.hostname!=='192.168.1.20'){unexpected.push(url.origin+p);return route.abort();}
        if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
        requests.push({p,params:Object.fromEntries(url.searchParams)});
        if(p.includes('/indexes/sd/')){
          const finish=()=>route.fulfill(state.fail?{status:404,headers,body:'Fixture preview absent'}:{headers,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#126040"/><text x="10" y="80" fill="white">'+p.split('/').pop()+'</text></svg>'}).catch(()=>{});
          if(state.hold){held.push(finish);return;}return finish();
        }
        let box={};
        if(p==='/library/sections')box={Directory:[{key:'1',title:'Films',type:'movie'}]};
        else if(p.includes('/metadata/')||p.includes('continueWatching')||p.endsWith('/all')||p.endsWith('/recentlyAdded'))box={Metadata:[movie],totalSize:1};
        await route.fulfill({headers,json:{MediaContainer:box}});
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('.card').first().click();await page.getByRole('button',{name:'Play',exact:true}).click();
      await page.waitForFunction(()=>window.mockCalls.some(call=>call.action==='play'));await page.evaluate(()=>window.advanceFixture(300000));
      return {page,requests,errors,unexpected,state,held,previews:()=>requests.filter(request=>request.p.includes('/indexes/sd/')),seeks:()=>page.evaluate(()=>window.mockCalls.filter(call=>call.action==='seek'))};
    }
    const f=await fixture(),{page}=f;
    await page.keyboard.press('Escape');assert.equal(await page.locator('#player-controls').isVisible(),false);
    await page.keyboard.press('ArrowRight');await page.getByLabel('Seek position',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'310000');assert.deepEqual(await f.seeks(),[]);
    await page.locator('.scrub-preview:not([hidden])').waitFor();assert.equal(f.previews().at(-1).p,'/library/parts/80/indexes/sd/310000');
    fs.mkdirSync(path.resolve('test-results'),{recursive:true});await page.screenshot({path:path.resolve('test-results/seek-preview-041.png')});
    assert.equal(f.previews().at(-1).params['X-Plex-Token'],'PREVIEW_FIXTURE_ONLY');
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');assert.deepEqual(await f.seeks(),[]);
    await page.keyboard.press('Enter');await page.waitForFunction(()=>window.mockCalls.filter(call=>call.action==='seek').length===1);
    assert.deepEqual(await f.seeks(),[{action:'seek',ms:330000}]);await page.waitForTimeout(20);
    await page.keyboard.press('Escape');await page.keyboard.press('ArrowLeft');assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'320000');
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal((await f.seeks()).length,1,'Back must leave playback position unchanged');
    await page.locator('#control-timeline').click();assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'330000','Timeline button opens the same staged interaction at the current time');
    await page.locator('.scrub-preview:not([hidden])').waitFor();
    const beforeBurst=f.previews().length;
    await page.evaluate(()=>{for(let n=0;n<6;n++)document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:39,bubbles:true}));});
    assert.deepEqual(await f.seeks(),[{action:'seek',ms:330000}]);await page.locator('.scrub-preview:not([hidden])').waitFor();
    assert.equal(f.previews().length,beforeBurst+1,'A rapid candidate burst should fetch only its last preview');
    assert.equal(f.previews().at(-1).p,'/library/parts/80/indexes/sd/390000');
    const beforeRepeat=Number(await page.getByLabel('Seek position',{exact:true}).inputValue());
    await page.evaluate(()=>{for(let n=0;n<40;n++)document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:39,repeat:true,bubbles:true}));});
    const repeatDelta=Number(await page.getByLabel('Seek position',{exact:true}).inputValue())-beforeRepeat;
    assert.ok(repeatDelta>=0&&repeatDelta<=10000,'Held-key repeats are throttled');assert.equal((await f.seeks()).length,1);
    await page.keyboard.press('Escape');
    await page.locator('#control-toggle').click();assert.equal(await page.evaluate(()=>window.mockState),'PAUSED');
    await page.locator('#control-timeline').click();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.waitForTimeout(30);
    assert.equal(await page.evaluate(()=>window.mockState),'PAUSED','Confirming a seek must retain pause');
    await page.locator('#control-forward').click();await page.getByRole('button',{name:'+1 minute',exact:true}).click();await page.waitForTimeout(30);
    assert.equal((await f.seeks()).at(-1).ms,400000,'Explicit skip choices retain their immediate seek behavior');
    assert.equal(await page.evaluate(()=>window.mockState),'PAUSED');

    // Delayed old image callbacks must not expose a stale frame after another candidate or Cancel.
    f.state.hold=true;await page.locator('#control-timeline').click();await until(()=>f.held.length===1);
    await page.evaluate(()=>{window.oldPreviewLoad=document.querySelector('.scrub-preview').onload;window.oldPreviewError=document.querySelector('.scrub-preview').onerror;});
    await page.keyboard.press('ArrowRight');await page.evaluate(()=>{window.oldPreviewLoad();window.oldPreviewError();});
    assert.equal(await page.locator('.scrub-preview').isVisible(),false);assert.match(await page.locator('.scrub-status').textContent(),/Loading preview/);
    await until(()=>f.held.length===2);await page.evaluate(()=>{window.cancelledPreviewLoad=document.querySelector('.scrub-preview').onload;});
    await page.keyboard.press('Escape');await page.evaluate(()=>window.cancelledPreviewLoad());
    for(const finish of f.held.splice(0))await finish();f.state.hold=false;
    assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal((await f.seeks()).length,3);
    await page.locator('#control-timeline').click();await page.locator('.scrub-preview:not([hidden])').waitFor();
    assert.equal(f.previews().at(-1).p,'/library/parts/80/indexes/sd/400000','Cancelled target must not leak into the next preview');
    // Focusable Cancel must work with OK as well as Back or a pointer.
    await page.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Enter');
    assert.equal((await f.seeks()).length,3,'OK on the focused Cancel button must not seek');
    await page.locator('#control-timeline').click();
    await page.getByLabel('Seek position',{exact:true}).evaluate(node=>{node.value='0';node.dispatchEvent(new Event('input'));});
    await page.keyboard.press('ArrowLeft');assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'0');
    await page.keyboard.press('ArrowUp');assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'60000');
    await page.keyboard.press('ArrowDown');assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'0');
    await page.getByLabel('Seek position',{exact:true}).evaluate(node=>{node.value='3599000';node.dispatchEvent(new Event('input'));});
    await page.keyboard.press('ArrowRight');assert.equal(await page.getByLabel('Seek position',{exact:true}).inputValue(),'3599000');
    await page.keyboard.press('Escape');assert.equal((await f.seeks()).length,3,'Clamping and changing the pending target cannot seek');
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);await page.close();

    for(const options of [{indexes:false},{previewImages:false},{fail:true}]){
      const fallback=await fixture(options);fallback.state.fail=!!options.fail;
      await fallback.page.keyboard.press('Escape');await fallback.page.keyboard.press('ArrowRight');
      const expected=options.indexes===false?'Plex has no preview images':options.previewImages===false?'Preview images are turned off':'Preview unavailable';
      await fallback.page.waitForFunction(text=>document.querySelector('.scrub-status').textContent.includes(text),expected);
      const count=fallback.previews().length;assert.equal(count,options.fail?1:0);
      await fallback.page.keyboard.press('ArrowRight');await fallback.page.waitForTimeout(280);assert.equal(fallback.previews().length,count,'Unavailable previews must not produce a request on every arrow');
      await fallback.page.keyboard.press('Enter');await fallback.page.waitForTimeout(20);assert.deepEqual(await fallback.seeks(),[{action:'seek',ms:320000}]);
      if(options.fail){fallback.state.fail=false;await fallback.page.locator('#control-timeline').click();await fallback.page.locator('.scrub-preview:not([hidden])').waitFor();assert.equal(fallback.previews().length,2,'A later scrub session retries a previously failed preview');}
      assert.deepEqual(fallback.errors,[]);assert.deepEqual(fallback.unexpected,[]);await fallback.page.close();
    }
    const large=await fixture({largeUI:true});
    for(const viewport of [{width:1920,height:1080},{width:3840,height:2160}]){
      await large.page.setViewportSize(viewport);await large.page.locator('#control-timeline').click();await large.page.locator('.scrub-preview:not([hidden])').waitFor();
      const violations=await large.page.evaluate(()=>{
        const bad=[];
        for(const node of document.querySelectorAll('.scrub-dialog .playback-menu-panel,.scrub-dialog h2,.scrub-dialog #playback-menu-hint,.scrub-dialog input,.scrub-dialog button,.scrub-dialog .scrub-preview')){
          if(node.hidden)continue;
          const r=node.getBoundingClientRect(),name=node.tagName+' '+(node.id||node.textContent);
          if(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1)bad.push({name,reason:'viewport'});
          for(let parent=node.parentElement;parent;parent=parent.parentElement){
            const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
            if(/auto|scroll|hidden/.test(style.overflowY)&&(r.top<box.top-1||r.bottom>box.bottom+1))bad.push({name,reason:'vertical clipping',parent:parent.id||parent.className});
            if(/auto|scroll|hidden/.test(style.overflowX)&&(r.left<box.left-1||r.right>box.right+1))bad.push({name,reason:'horizontal clipping',parent:parent.id||parent.className});
          }
        }
        return bad;
      });
      assert.deepEqual(violations,[],'Large-text preview content must fit '+viewport.width+'px viewport');await large.page.keyboard.press('Escape');
    }
    assert.deepEqual(large.errors,[]);assert.deepEqual(large.unexpected,[]);await large.page.close();
    console.log('PASS: indexed thumbnail URLs, staged D-pad and Timeline seeking, one seek on OK, Back/Cancel, repeat throttle/debounce, paused seeks, explicit skips, stale-image races, unavailable/off/error fallback, and large-text 1080p/4K bounds.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
