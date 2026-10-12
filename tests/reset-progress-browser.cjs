'use strict';
// Synthetic Plex only: resets must never change the user's real library.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'../app');
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'};
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
const movie={ratingKey:'1',type:'movie',title:'Progress fixture',duration:7200000,viewOffset:120000,viewCount:1,Media:[]};
const episode={ratingKey:'2',type:'episode',title:'Episode fixture',grandparentTitle:'Series fixture',grandparentRatingKey:'10',index:1,parentIndex:1,duration:1800000,viewOffset:60000,viewCount:0,Media:[]};
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),requests=[],errors=[],unexpected=[],offsets={};
    let fail=false,hold=false,pending=[];
    const recoveryKey='tizenosplex.recoveryPositions.fixture.owner';
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');
      localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','fixture');
      localStorage.setItem('tizenosplex.token','RESET_OWNER_FIXTURE');
      localStorage.setItem('tizenosplex.recoveryPositions.fixture.owner',JSON.stringify([{id:'1',time:180000,updated:Date.now()-1000},{id:'2',time:60000,updated:Date.now()-1000}]));
      localStorage.setItem('tizenosplex.recoveryPositions.fixture.2',JSON.stringify([{id:'1',time:240000,updated:Date.now()-1000}]));
      localStorage.setItem('tizenosplex.recoveryPositions.other.owner',JSON.stringify([{id:'1',time:300000,updated:Date.now()-1000}]));
    });
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),p=url.pathname;
      if(url.hostname==='127.0.0.1')return route.continue();
      if(url.hostname!=='192.168.1.20'){unexpected.push(url.origin+p);return route.abort();}
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
      const auth=req.headers()['x-plex-token'],scope=auth==='RESET_CHILD_FIXTURE'?'2':'owner';
      requests.push({p,auth,method:req.method(),params:Object.fromEntries(url.searchParams),client:req.headers()['x-plex-client-identifier']});
      let box={};
      const items=[movie,episode].map(item=>({...item,viewOffset:offsets[scope+'.'+item.ratingKey]===undefined?item.viewOffset:offsets[scope+'.'+item.ratingKey]}));
      if(p==='/:/timeline'){
        const finish=async()=>{offsets[scope+'.'+url.searchParams.get('ratingKey')]=Number(url.searchParams.get('time'));await route.fulfill({status:200,headers,body:''});};
        if(fail)return route.fulfill({status:503,headers,body:'Fixture refused reset'});
        if(hold){pending.push(finish);return;}return finish();
      }
      if(p==='/library/sections')box={Directory:[{key:'1',title:'Films',type:'movie'}]};
      else if(p.startsWith('/library/metadata/'))box={Metadata:items.filter(item=>item.ratingKey===p.split('/').pop())};
      else if(p.includes('continueWatching')){const remaining=items.filter(item=>item.viewOffset>0);box={Metadata:remaining,totalSize:remaining.length};}
      else if(p.endsWith('/all')||p.endsWith('/recentlyAdded'))box={Metadata:items,totalSize:items.length};
      else if(p==='/photo/:/transcode')return route.fulfill({status:404,headers,body:''});
      await route.fulfill({headers,json:{MediaContainer:box}});
    });
    const activate=async name=>{const button=page.getByRole('button',{name,exact:true});await button.focus();await page.keyboard.press('Enter');};
    const detail=async()=>{await activate('Films');await page.locator('[data-library-index="0"]').waitFor();await page.locator('[data-library-index="0"]').click();await page.getByRole('button',{name:'Reset playback progress',exact:true}).waitFor();};
    const resets=()=>requests.filter(request=>request.p==='/:/timeline');
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('.card').first().waitFor();await detail();
    await page.getByRole('button',{name:'Resume at 3:00',exact:true}).waitFor();
    await activate('Reset playback progress');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
    await page.keyboard.press('Escape');assert.equal(resets().length,0);assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Reset playback progress');
    await activate('Reset playback progress');await activate('Cancel');assert.equal(resets().length,0);
    fail=true;await activate('Reset playback progress');await activate('Reset progress');
    await page.getByText(/Could not reset progress\. Try again/).waitFor();assert.equal((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),recoveryKey)).length,2);
    await page.getByRole('button',{name:'Resume at 3:00',exact:true}).waitFor();
    fail=false;hold=true;await activate('Reset playback progress');await activate('Reset progress');
    await page.getByText('Resetting progress…',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Reset playback progress',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Resume at 3:00',exact:true}).isDisabled(),true);
    await page.keyboard.press('Enter');assert.equal(resets().length,2,'Repeated OK must not duplicate the mutation');
    await pending.shift()();hold=false;
    await page.getByRole('button',{name:'Undo progress reset',exact:true}).waitFor();assert.equal(offsets['owner.1'],0);
    await page.getByRole('button',{name:'Play',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Mark unwatched',exact:true}).count(),1,'Reset must preserve watched status');
    assert.deepEqual((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),recoveryKey)).map(point=>point.id),['2']);
    const otherScope=await page.evaluate(()=>[localStorage.getItem('tizenosplex.recoveryPositions.fixture.2'),localStorage.getItem('tizenosplex.recoveryPositions.other.owner')]);
    assert.equal(JSON.parse(otherScope[0])[0].time,240000);assert.equal(JSON.parse(otherScope[1])[0].time,300000);
    fail=true;await activate('Undo progress reset');await page.getByText(/Could not restore progress\. Try again/).waitFor();assert.equal(offsets['owner.1'],0);
    fail=false;await activate('Undo progress reset');await page.getByText('Previous resume position restored.',{exact:true}).waitFor();assert.equal(offsets['owner.1'],180000);
    await page.getByRole('button',{name:'Resume at 3:00',exact:true}).waitFor();
    await activate('Reset playback progress');await activate('Reset progress');await page.getByRole('button',{name:'Undo progress reset',exact:true}).waitFor();
    await page.keyboard.press('Escape');await activate('Home');await page.locator('.card').first().waitFor();
    assert.equal(await page.locator('[data-home-focus="continue:0"]').getAttribute('aria-label').then(label=>label.includes('Progress fixture')),false,'Continue Watching must reload without the cleared movie');
    await activate('Films');await page.locator('[data-library-index="0"]').click();await page.getByRole('button',{name:'Play',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Reset playback progress',exact:true}).count(),0,'Reopening cannot resurrect a cleared recovery checkpoint');
    await page.reload();await page.locator('.card').first().waitFor();await activate('Films');await page.locator('[data-library-index="0"]').click();await page.getByRole('button',{name:'Play',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Reset playback progress',exact:true}).count(),0,'Restart must preserve the server reset');
    await page.keyboard.press('Escape');await page.locator('[data-library-index="1"]').click();await activate('Reset playback progress');
    assert.match(await page.getByRole('dialog').textContent(),/Plex may still recommend this or the next episode/);
    await activate('Reset progress');await page.getByRole('button',{name:'Undo progress reset',exact:true}).waitFor();assert.equal(offsets['owner.2'],0);
    assert.equal(await page.getByRole('button',{name:'Mark watched',exact:true}).count(),1);
    // A different profile uses its own token and recovery checkpoint.
    await page.evaluate(()=>localStorage.setItem('tizenosplex.session',JSON.stringify({server:'http://192.168.1.20:32400',machineId:'fixture',serverToken:'RESET_CHILD_FIXTURE',userToken:'RESET_CHILD_USER_FIXTURE',profile:{id:'2',title:'Other fixture'}})));
    await page.reload();await page.locator('.card').first().waitFor();await detail();
    await page.getByRole('button',{name:'Resume at 4:00',exact:true}).waitFor();await activate('Reset playback progress');await activate('Reset progress');
    await page.getByRole('button',{name:'Undo progress reset',exact:true}).waitFor();assert.equal(offsets['2.1'],0);
    assert.equal(resets().at(-1).auth,'RESET_CHILD_FIXTURE');assert.equal(resets().every(request=>request.client&&request.params.state==='stopped'),true);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),recoveryKey),[]);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tizenosplex.recoveryPositions.other.owner'))[0].time),300000);
    // Leaving a pending reset cannot race a new playback attempt or leave a stale detail.
    await activate('Undo progress reset');await page.getByText('Previous resume position restored.',{exact:true}).waitFor();
    hold=true;await activate('Reset playback progress');await activate('Reset progress');await page.getByText('Resetting progress…',{exact:true}).waitFor();
    await page.keyboard.press('Escape');await page.locator('[data-library-index="0"]').click();await activate('Resume at 4:00');
    await page.getByText('Wait for the playback progress update to finish.',{exact:true}).waitFor();
    await pending.shift()();hold=false;await page.getByRole('button',{name:'Play',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Reset playback progress',exact:true}).count(),0,'Late success must refresh reopened details');
    assert.equal(requests.some(request=>/scrobble/.test(request.p)),false,'Progress reset must never scrobble or unscrobble');
    assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
    console.log('PASS: reset confirmation defaults to Cancel; Back/Cancel do not mutate; error retains progress and allows retry; duplicate activation guard; server reset and Undo; watched status preserved; recovery cleanup/restart; fresh Continue Watching; episode limitation explained; profile/server isolation and scoped credential headers.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
