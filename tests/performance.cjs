'use strict';
// Controlled development comparison. This is not a benchmark of Samsung hardware
// or the official Plex app. No real Plex credentials or library data are used.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source={current:path.join(root,'app')};
const versions=['current'];
if(process.env.PLEX_BENCHMARK_BASELINE){
  source.baseline=path.resolve(process.env.PLEX_BENCHMARK_BASELINE);
  if(!fs.existsSync(path.join(source.baseline,'index.html')))throw new Error('PLEX_BENCHMARK_BASELINE must point to an extracted app folder containing index.html.');
  versions.unshift('baseline');
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://test'),parts=url.pathname.split('/'),folder=source[parts[1]],file=folder&&path.join(folder,...parts.slice(2));
  if(!file||!file.startsWith(folder+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const mime={'.js':'application/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
  res.setHeader('Content-Type',mime[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});
const item={ratingKey:'42',type:'movie',title:'Performance fixture',duration:600000,Media:[{videoCodec:'h264',audioCodec:'aac',Part:[{key:'/library/parts/42/file.mp4'}]}]};
function median(values){const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  const samples={baseline:[],current:[]};
  try{
    for(let iteration=0;iteration<7;iteration++)for(const version of versions){
      const page=await browser.newPage({viewport:{width:1920,height:1080}}),cdp=await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      await page.addInitScript(()=>{
        localStorage.setItem('tizenosplex.token','BENCHMARK_ONLY');localStorage.setItem('tizenosplex.server','http://192.168.1.20:32400');localStorage.setItem('tizenosplex.serverId','fixture');localStorage.setItem('tizenosplex.client','fixed-fixture');
        window.benchmark={keys:[]};
        const observer=new MutationObserver(()=>{if(document.querySelector('.card')&&!window.benchmark.firstCard){requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!window.benchmark.firstCard)window.benchmark.firstCard=performance.now();}));observer.disconnect();}});
        observer.observe(document,{childList:true,subtree:true});
        document.addEventListener('keydown',()=>{const start=performance.now();requestAnimationFrame(()=>window.benchmark.keys.push(performance.now()-start));},true);
        document.addEventListener('click',event=>{if(event.target.textContent==='Play')window.benchmark.playStart=performance.now();},true);
        window.webapis={avplay:{open(){},setDisplayRect(){},setDisplayMethod(){},setListener(){},prepareAsync(ok){setTimeout(ok,10);},getDuration(){return 600000;},play(){window.benchmark.playReady=performance.now();},stop(){},close(){},getTotalTrackInfo(){return [];},getCurrentStreamInfo(){return [];},setSilentSubtitle(){}},appcommon:{AppCommonScreenSaverState:{SCREEN_SAVER_ON:1,SCREEN_SAVER_OFF:0},setScreenSaver(){}}};
      });
      let mediaRequests=0,cloudRequests=0;
      await page.route('https://plex.tv/**',route=>{cloudRequests++;return route.abort();});
      await page.route('http://192.168.1.20:32400/**',async route=>{
        if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return;}
        mediaRequests++;const p=new URL(route.request().url()).pathname;
        const box=p==='/library/sections'?{Directory:[{key:'1',title:'Movies',type:'movie'}]}:p.includes('/metadata/')?{Metadata:[item]}:{Metadata:Array.from({length:12},(_,i)=>({...item,ratingKey:String(42+i)})),size:12,totalSize:24};
        await new Promise(r=>setTimeout(r,10));await route.fulfill({json:{MediaContainer:box},headers:{'access-control-allow-origin':'*'}});
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/'+version+'/index.html');
      await page.waitForFunction(()=>window.benchmark.firstCard);
      const startupRequests=mediaRequests;
      for(let i=0;i<5;i++)await page.keyboard.press(i%2?'ArrowLeft':'ArrowRight');
      await page.locator('.card').first().click();await page.getByRole('button',{name:'Play',exact:true}).click();
      await page.waitForFunction(()=>window.benchmark.playReady);
      const measurement=await page.evaluate(()=>({startup:window.benchmark.firstCard,focus:window.benchmark.keys,play:window.benchmark.playReady-window.benchmark.playStart}));
      samples[version].push({...measurement,startupRequests,cloudRequests});await page.close();
    }
    const summary={environment:(process.env.PLAYWRIGHT_CHANNEL||'Playwright Chromium')+', headless, 1920x1080, 4x CPU slowdown, 10 ms mocked server latency; seven independent page loads per build. Not official Plex or real TV results.'};
    for(const version of versions)summary[version]={startupMedianMs:Math.round(median(samples[version].map(x=>x.startup))),focusMedianMs:Math.round(median(samples[version].flatMap(x=>x.focus))),playMedianMs:Math.round(median(samples[version].map(x=>x.play))),startupRequests:samples[version].map(x=>x.startupRequests),cloudRequests:samples[version].map(x=>x.cloudRequests)};
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results','performance.json'),JSON.stringify({summary,samples},null,2));console.log(JSON.stringify(summary,null,2));
    if(summary.current.cloudRequests.some(x=>x!==0)||summary.current.startupRequests.some(x=>x>2))throw new Error('Healthy-server startup added network work.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
