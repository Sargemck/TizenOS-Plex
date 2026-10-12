'use strict';
// Synthetic local Plex feeds: two complete portrait rows, including captions,
// must fit without horizontal scrolling in either interface text size.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const app=path.resolve(__dirname,'../app'),out=path.resolve('test-results');
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
const films=Array.from({length:240},(_,i)=>({ratingKey:String(i+1),type:'movie',title:i%3?'Synthetic film '+(i+1):'日本語の映画・中文电影 — A long readable synthetic title '+(i+1),year:2026,duration:600000,viewOffset:i%2?0:120000,thumb:'/library/metadata/'+(i+1)+'/thumb'}));
const server=http.createServer((req,res)=>{
  const file=path.join(app,new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(app+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});
async function geometry(page,home){
  const result=await page.evaluate(home=>{
    const main=document.getElementById('main'),bounds=main.getBoundingClientRect(),scale=document.getElementById('ui-root').getBoundingClientRect().width/1920;
    const cards=home?Array.from(document.querySelectorAll('.home-row')).slice(0,2).flatMap(row=>Array.from(row.querySelectorAll('.card'))):Array.from(document.querySelectorAll('[data-library-index]')).filter(card=>Number(card.dataset.libraryIndex)<18);
    const errors=[];
    if(!home){
      const summary=document.querySelector('.filter-summary'),first=cards[0].getBoundingClientRect();
      if(summary&&summary.getBoundingClientRect().bottom+7*scale>first.top+.5)errors.push('Filter summary overlaps first-card focus ring');
    }
    cards.forEach(card=>{
      const box=card.getBoundingClientRect();
      if(box.left-7*scale<bounds.left-.5||box.right+7*scale>bounds.right+.5||box.top-7*scale<bounds.top-.5||box.bottom+7*scale>bounds.bottom+.5)errors.push({text:card.textContent,box:box.toJSON(),bounds:bounds.toJSON()});
      const poster=card.querySelector('.poster').getBoundingClientRect();if(Math.abs(poster.height/poster.width-1.5)>.02)errors.push('Poster ratio');
      ['.card-title','.card-info','.card-remaining'].forEach(selector=>{const node=card.querySelector(selector);if(node&&node.getBoundingClientRect().bottom>box.bottom+.5)errors.push('Clipped caption '+selector);});
    });
    return {count:cards.length,errors,columns:getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length,scroll:main.scrollLeft};
  },home);
  assert.equal(result.count,18,'Two complete nine-title rows are loaded');assert.equal(result.columns,9);assert.equal(result.scroll,0);assert.deepEqual(result.errors,[],JSON.stringify(result.errors));
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try{
    for(const large of [false,true]){
      const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{localStorage.setItem('tizenosplex.token','DENSITY_FIXTURE_ONLY');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','fixture');});
      await page.route('https://plex.tv/**',()=>{throw Error('Unexpected cloud request');});
      await page.route('http://192.168.1.20:32400/**',async route=>{
        const url=new URL(route.request().url()),p=url.pathname;
        if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
        requests.push(p);
        if(p==='/photo/:/transcode')return route.fulfill({headers,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#496345"/><rect x="8" y="8" width="304" height="464" fill="none" stroke="#c4f184" stroke-width="8"/></svg>'});
        const start=Number(url.searchParams.get('X-Plex-Container-Start'))||0,size=Number(url.searchParams.get('X-Plex-Container-Size'))||12;
        const box=p==='/library/sections'?{Directory:[{key:'1',title:'Films',type:'movie'}]}:p.indexOf('/library/metadata/')===0?{Metadata:[films[0]]}:{Metadata:films.slice(start,start+size),totalSize:films.length};
        return route.fulfill({headers,json:{MediaContainer:box}});
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('[data-home-focus="continue:8"]').waitFor();
      if(large){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Subtitles & accessibility',exact:true}).click();await page.getByLabel('Interface text',{exact:true}).selectOption('large');await page.getByRole('button',{name:'Home',exact:true}).click();}
      await page.locator('[data-home-focus="recent-1:8"]').waitFor();
      for(const viewport of [{width:1920,height:1080},{width:3840,height:2160},{width:1280,height:720}]){
        await page.setViewportSize(viewport);await page.waitForFunction(()=>Math.abs(document.getElementById('ui-root').getBoundingClientRect().width-innerWidth)<1);
        await page.locator('[data-home-focus="continue:0"]').focus();await page.locator('#main').evaluate(node=>node.scrollTop=0);await geometry(page,true);
        if(viewport.width===1920)await page.screenshot({path:path.join(out,'density-home-'+(large?'large':'normal')+'.png')});
      }
      await page.setViewportSize({width:1920,height:1080});await page.getByRole('button',{name:'Films',exact:true}).click();await page.locator('[data-library-index="17"]').waitFor();await geometry(page,false);
      assert.equal(await page.locator('#focused-title').textContent(),films[0].title,'Initially focused library card exposes its complete title');
      await page.screenshot({path:path.join(out,'density-library-'+(large?'large':'normal')+'.png')});
      const before=requests.filter(p=>p.indexOf('/library/metadata/')===0).length;
      await page.locator('[data-library-index="8"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.libraryIndex),'8');
      await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.libraryIndex),'17');await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.dataset.libraryIndex),'8');
      for(let i=0;i<15;i++)await page.keyboard.press('ArrowDown');await page.waitForTimeout(100);
      assert.ok(await page.locator('.library-grid .card').count()<70,'Virtualization keeps card DOM bounded');
      assert.equal(requests.filter(p=>p.indexOf('/library/metadata/')===0).length,before,'Remote focus does not fetch details');assert.deepEqual(errors,[]);await page.close();
    }
    console.log('PASS: two complete nine-column portrait rows, title/context and progress bounds, normal/larger text, 1080p/4K/720p scaling, row-edge navigation and bounded virtualization.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
