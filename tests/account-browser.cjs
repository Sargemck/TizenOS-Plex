'use strict';
// Synthetic accounts and server only; never sign out a real TV or Plex account.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'../app');
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS'};
const movie={ratingKey:'1',type:'movie',title:'Account fixture',duration:600000,viewOffset:120000,Media:[]};
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://fixture').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],unexpected=[],mutations=[];
    let finishReset;
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      if(localStorage.getItem('account-fixture-seeded'))return;
      localStorage.setItem('account-fixture-seeded','1');
      const values={server:'http://192.168.1.20:32400',serverId:'fixture',token:'OLD_ACCOUNT_FIXTURE',accountToken:'OLD_ACCOUNT_FIXTURE',client:'STABLE_CLIENT_FIXTURE',
        'savedTitles.fixture.owner':'[{"id":"1","type":"movie"}]','savedTitles.other.child':'[{"id":"2","type":"show"}]',
        'recentSearches.fixture.owner':'["Private old-account search"]','preferences.owner':'{}','preferences.child':'{}',
        'libraryPreferences.fixture.owner.1':'{}','showPreferences.other.child.2':'{}','seriesPositions.fixture.owner':'[{"id":"2"}]',
        'recoveryPositions.fixture.owner':'[{"id":"1","time":120000,"updated":1}]','recoveryPositions.other.child':'[]'};
      Object.keys(values).forEach(key=>localStorage.setItem('tizenosplex.'+key,values[key]));
    });
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),p=url.pathname;
      if(url.hostname==='127.0.0.1')return route.continue();
      if(!['192.168.1.20','plex.tv'].includes(url.hostname)){unexpected.push(url.origin+p);return route.abort();}
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(url.hostname==='plex.tv'){
        const data=p==='/api/v2/pins'?{id:17,code:'ABCD',expiresIn:300}:p==='/api/v2/resources'?
          [{provides:'server',name:'Fixture server',clientIdentifier:'fixture',accessToken:'NEW_ACCOUNT_SERVER_FIXTURE',connections:[{local:true,uri:'http://192.168.1.20:32400'}]}]:{authToken:'NEW_ACCOUNT_FIXTURE'};
        return route.fulfill({headers,json:data});
      }
      if(p==='/:/timeline'){
        mutations.push({path:p,token:request.headers()['x-plex-token']});
        finishReset=()=>route.fulfill({status:200,headers,body:''});return;
      }
      if(request.method()==='PUT'||/scrobble/.test(p))mutations.push({path:p});
      let box={};
      if(p==='/identity')box={machineIdentifier:'fixture'};
      else if(p==='/library/sections')box={Directory:[{key:'1',title:'Films',type:'movie'}]};
      else if(p==='/library/metadata/1')box={Metadata:[movie]};
      else if(p.includes('continueWatching')||p.endsWith('/all')||p.endsWith('/recentlyAdded'))box={Metadata:[movie],totalSize:1};
      await route.fulfill({headers,json:{MediaContainer:box}});
    });
    const activate=async name=>{await page.getByRole('button',{name,exact:true}).focus();await page.keyboard.press('Enter');};
    const connection=async()=>{await activate('Settings');await activate('Connection settings');};
    const storage=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])));
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('.card').first().waitFor();
    await connection();const before=await storage();
    await activate('Sign out on this TV');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Keep signed in');
    assert.match(await page.getByRole('dialog').innerText(),/all accounts, profiles and servers/);
    assert.match(await page.getByRole('dialog').innerText(),/server media and watch progress stay unchanged/);
    await page.keyboard.press('Enter');assert.deepEqual(await storage(),before,'Default OK must cancel without clearing anything');
    await activate('Sign out on this TV');await page.keyboard.press('Escape');assert.deepEqual(await storage(),before,'Back must cancel without clearing anything');
    await page.reload();await page.locator('.card').first().waitFor();await activate('Films');await page.locator('[data-library-index="0"]').click();
    await activate('Reset playback progress');await activate('Reset progress');
    await page.getByText('Resetting progress\u2026',{exact:true}).waitFor();
    await connection();await activate('Sign out on this TV');await activate('Sign out and clear local data');
    await page.getByRole('button',{name:'Link Plex and find server',exact:true}).waitFor();
    assert.deepEqual(await storage(),{'account-fixture-seeded':'1','tizenosplex.client':'STABLE_CLIENT_FIXTURE'},'Confirmed sign-out clears all local account scopes and credentials, preserving client identity');
    assert.ok(finishReset);await finishReset();
    await page.waitForTimeout(100);
    assert.deepEqual(await storage(),{'account-fixture-seeded':'1','tizenosplex.client':'STABLE_CLIENT_FIXTURE'},'An old-account response cannot recreate cleared recovery records');
    await activate('Link Plex and find server');await page.locator('.card').first().waitFor();
    await activate('My List');await page.getByRole('heading',{name:'Save something for later',exact:true}).waitFor();
    await activate('Search / Filter');assert.equal(await page.getByRole('button',{name:'Private old-account search',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.savedTitles.fixture.owner')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.recentSearches.fixture.owner')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.client')),'STABLE_CLIENT_FIXTURE');
    assert.deepEqual(mutations,[{path:'/:/timeline',token:'OLD_ACCOUNT_FIXTURE'}],'Signing out/linking must not mutate server watch history');
    // A failed data deletion must retain credentials and prevent a new account link.
    await page.evaluate(()=>{
      localStorage.setItem('tizenosplex.recentSearches.fixture.owner','["New private search"]');
      window.originalRemoveItem=Storage.prototype.removeItem;
      Storage.prototype.removeItem=function(key){if(key==='tizenosplex.recentSearches.fixture.owner')throw new Error('Synthetic storage failure');return window.originalRemoveItem.call(this,key);};
    });
    await connection();await activate('Sign out on this TV');await activate('Sign out and clear local data');
    await page.getByText(/Could not clear this TV.*local data/).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('tizenosplex.token')),'NEW_ACCOUNT_FIXTURE');
    assert.equal(await page.getByRole('button',{name:'Link Plex and find server',exact:true}).count(),0);
    await page.evaluate(()=>{Storage.prototype.removeItem=window.originalRemoveItem;});
    await activate('Sign out and clear local data');await page.getByRole('button',{name:'Link Plex and find server',exact:true}).waitFor();
    assert.deepEqual(await storage(),{'account-fixture-seeded':'1','tizenosplex.client':'STABLE_CLIENT_FIXTURE'});
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    console.log('PASS: sign-out defaults to Keep signed in; OK/Back cancel; explicit all-profile local cleanup preserves client and server history; stale account response cannot restore data; a different account on the same server inherits no list/search; storage failure retains sign-in until cleanup succeeds.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
