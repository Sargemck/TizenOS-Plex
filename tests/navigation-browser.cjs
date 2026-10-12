'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'../app');
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);});
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
const longTitles=['A film with a very long title that must never widen its poster column','日本語の長い映画タイトルと字幕の表示を確認するための作品名','用于检查海报排列和屏幕边缘的很长的中文电影名称'];
const item=i=>({ratingKey:String(i),title:i<12?longTitles[i%longTitles.length]+' '+i:'Film '+i,type:'movie',year:2025,Media:[{Part:[{key:'/library/parts/'+i+'/file.mp4'}]}]});
async function checkGridBounds(page){
 const bounds=await page.evaluate(()=>{const main=document.getElementById('main'),rect=main.getBoundingClientRect();return {left:rect.left,right:rect.left+main.clientWidth,clientWidth:main.clientWidth,scrollWidth:main.scrollWidth,scrollLeft:main.scrollLeft,cards:Array.from(document.querySelectorAll('.card'),card=>{const r=card.getBoundingClientRect(),style=getComputedStyle(card);return {left:r.left,right:r.right,width:r.width,ring:parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset)};})};});
 assert.ok(bounds.cards.length>=9,'Layout fixture must include the rightmost column');
 assert.ok(bounds.scrollWidth<=bounds.clientWidth,'Long titles must not create horizontal overflow');
 assert.equal(bounds.scrollLeft,0,'Focusing an edge card must not pan the grid horizontally');
 for(const card of bounds.cards){assert.ok(card.left-card.ring>=bounds.left,'Left poster and focus ring must be inside the scroll viewport');assert.ok(card.right+card.ring<=bounds.right,'Right poster and focus ring must be inside the scroll viewport');assert.ok(Math.abs(card.width-bounds.cards[0].width)<1,'All nine poster columns must remain equal despite title length');}
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];let failPage=-1,holdPage=-1,held=[],unknownTotal=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.token','FIXTURE_ONLY');localStorage.setItem('tizenosplex.serverId','fixture');});
  await page.route('http://192.168.1.20:32400/**',async route=>{
   const url=new URL(route.request().url()),p=url.pathname;if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   let box;
   if(p==='/library/sections')box={Directory:[{key:'1',type:'movie',title:'Films'},{key:'2',type:'movie',title:'Other library'}]};
   else if(p.includes('/metadata/'))box={Metadata:[item(Number(p.split('/').pop()))]};
   else{const start=Number(url.searchParams.get('X-Plex-Container-Start'));requests.push({p,start,params:Object.fromEntries(url.searchParams)});if(start===holdPage){held.push(route);return;}if(start===failPage){await route.fulfill({status:503,headers,body:'Fixture failure'});return;}
    const total=p.includes('/sections/2/')?(unknownTotal?25:7):2503;box={Metadata:Array.from({length:Math.min(12,Math.max(0,total-start))},(_,i)=>item(start+i)),totalSize:total,size:Math.min(12,total-start)};if(unknownTotal)delete box.totalSize;}
   await route.fulfill({json:{MediaContainer:box},headers});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('.card').first().waitFor();
  await page.getByRole('button',{name:'Films',exact:true}).click();await page.locator('[data-library-index="0"]').waitFor();
  assert.equal(await page.getByRole('button',{name:/Next page|Previous/}).count(),0);
  await checkGridBounds(page);
  for(let i=1;i<9;i++){await page.keyboard.press('ArrowRight');await page.waitForFunction(index=>document.activeElement.getAttribute('data-library-index')===String(index),i);await checkGridBounds(page);}
  await page.screenshot({path:path.resolve('test-results/library-layout-normal.png')});
  for(let i=0;i<8;i++)await page.keyboard.press('ArrowLeft');
  for(let i=0;i<40;i++){await page.keyboard.press('ArrowDown');const expected=(i+1)*9;await page.waitForFunction(index=>document.activeElement.getAttribute('data-library-index')===String(index),expected);assert.ok(await page.locator('.card').count()<=54);}
  const selected=await page.evaluate(()=>({index:document.activeElement.getAttribute('data-library-index'),scroll:document.getElementById('main').scrollTop}));
  await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Film 360',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.activeElement.getAttribute('data-library-index')==='360');
  assert.equal(await page.locator('#main').evaluate(n=>n.scrollTop),selected.scroll,'Back must restore the scroll position');
  // A scrollbar jump must request the nearby chunk, not walk through 200 pages.
  const before=requests.length;await page.locator('#main').evaluate(n=>n.scrollTop=n.scrollHeight);
  await page.locator('[data-library-index="2502"]').waitFor();assert.ok(requests.length-before<=5);assert.ok(await page.locator('.card').count()<=54);
  await page.locator('[data-library-index="2502"]').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-library-index')),'2502');
  await page.screenshot({path:path.resolve('test-results/infinite-library-end.png')});
  // A missing chunk preserves existing titles and can be retried.
  failPage=120;await page.locator('#main').evaluate(n=>n.scrollTop=13*(parseFloat(getComputedStyle(n).getPropertyValue('--card-height'))+18)+80);
  await page.getByRole('button',{name:'Retry loading titles',exact:true}).waitFor();
  failPage=-1;await page.getByRole('button',{name:'Retry loading titles',exact:true}).click();await page.locator('[data-library-index="120"]').waitFor();
  // Switching library cancels in-flight data and cannot append it into the new grid.
  holdPage=600;await page.locator('#main').evaluate(n=>n.scrollTop=66*(parseFloat(getComputedStyle(n).getPropertyValue('--card-height'))+18)+80);await page.waitForTimeout(150);assert.ok(held.length);
  await page.getByRole('button',{name:'Other library',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.card').length===7);
  for(const route of held)await route.fulfill({json:{MediaContainer:{Metadata:[item(600)],totalSize:2503}},headers}).catch(()=>{});
  await page.waitForTimeout(100);assert.equal(await page.locator('.card').count(),7);assert.equal(await page.locator('[data-library-index="600"]').count(),0);
  unknownTotal=true;await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('[data-library-index="0"]').waitFor();
  for(const expected of [9,18,24]){await page.keyboard.press('ArrowDown');await page.waitForFunction(index=>document.activeElement.getAttribute('data-library-index')===String(index),expected);}
  await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-library-index')),'24');
  assert.match(await page.locator('.page-heading').textContent(),/25 items/);
  await page.getByRole('button',{name:'Films',exact:true}).click();await page.locator('.card').first().waitFor();
  await page.getByRole('button',{name:'Search / Filter',exact:true}).click();await page.getByLabel('Title contains').fill('alpha');await page.getByLabel('Sort',{exact:true}).selectOption('year:desc');await page.getByRole('button',{name:'Show results',exact:true}).click();await page.locator('.card').first().waitFor();
  await page.getByRole('button',{name:'Other library',exact:true}).click();await page.locator('.card').first().waitFor();
  await page.getByRole('button',{name:'Search / Filter',exact:true}).click();assert.equal(await page.getByLabel('Title contains').inputValue(),'');
  await page.getByLabel('Library',{exact:true}).selectOption('1');assert.equal(await page.getByLabel('Title contains').inputValue(),'alpha');assert.equal(await page.getByLabel('Sort',{exact:true}).inputValue(),'year:desc');
  await page.getByLabel('Library',{exact:true}).selectOption('2');await page.getByLabel('Title contains').fill('beta');await page.getByRole('button',{name:'Show results',exact:true}).click();await page.locator('.card').first().waitFor();
  await page.getByRole('button',{name:'Films',exact:true}).click();await page.locator('.card').first().waitFor();await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.locator('.card').first().waitFor();
  await page.getByRole('button',{name:'Other library',exact:true}).click();await page.locator('.card').first().waitFor();assert.equal(requests.filter(r=>r.p.includes('/sections/2/all')).slice(-1)[0].params.title,'beta');
  await page.screenshot({path:path.resolve('test-results/saved-library-filters.png')});
  await page.evaluate(()=>localStorage.setItem('tizenosplex.session',JSON.stringify({server:'http://192.168.1.20:32400',machineId:'fixture',serverToken:'PROFILE_2_FIXTURE',userToken:'PROFILE_2_FIXTURE',profile:{id:'2',title:'Second profile'}})));
  await page.reload();await page.locator('.card').first().waitFor();await page.getByRole('button',{name:'Other library',exact:true}).click();await page.locator('.card').first().waitFor();assert.equal(requests.filter(r=>r.p.includes('/sections/2/all')).slice(-1)[0].params.title,undefined);
  await page.evaluate(()=>localStorage.setItem('tizenosplex.preferences.2',JSON.stringify({largeUI:true})));
  await page.reload();await page.locator('.card').first().waitFor();await page.getByRole('button',{name:'Films',exact:true}).click();await page.locator('[data-library-index="0"]').waitFor();
  assert.equal(await page.locator('body.large-ui').count(),1);
  for(let i=0;i<9;i++){if(i)await page.keyboard.press('ArrowRight');await page.waitForFunction(index=>document.activeElement.getAttribute('data-library-index')===String(index),i);await checkGridBounds(page);}
  await page.screenshot({path:path.resolve('test-results/library-layout-large.png')});
  assert.deepEqual(errors,[]);console.log('PASS: 2,503-title continuous grid, 40 remote rows, bounded DOM, title return restoration, direct scrollbar jump, partial last row, retry, stale-request isolation, and long Latin/Japanese/Chinese title layout with normal/large text and edge focus.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
