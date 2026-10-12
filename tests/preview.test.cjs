'use strict';
const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const Preview=require('../app/preview.js');
const Features=require('../app/features.js');
const {createService}=require('../app/preview-service.js');
const scope='SYNTHETIC_SCOPE';
const tile={id:'42',scope,title:'Fixture film',image:'/library/metadata/42/thumb'};
const payload=()=>({version:1,server:'https://192.168.1.20:32400',token:'PREVIEW_FIXTURE_ONLY',sections:[{title:'Recently added',tiles:[{...tile}]}]});
const control=(data,operation='http://samsung.com/appcontrol/operation/eden_resume')=>({appControl:{operation,data:[{key:'PAYLOAD',value:[JSON.stringify({values:JSON.stringify(data)})]}]}});
function fixture(options={}) {
  const files=new Map(),published=[],requests=[],timers=new Map(); let exits=0,now=1000000000,nextTimer=0;
  const fs={existsSync:p=>files.has(p),mkdirSync:p=>files.set(p,null),readFileSync:p=>{if(!files.has(p))throw Error('Absent');return files.get(p);},writeFileSync:(p,v)=>files.set(p,v),unlinkSync:p=>files.delete(p),readdirSync:p=>Array.from(files.keys()).filter(k=>k.startsWith(p+'/')).map(k=>k.slice(p.length+1))};
  const client={get(address,callback){
    const req=new EventEmitter();req.destroyed=false;req.destroy=()=>{if(req.destroyed)return;req.destroyed=true;queueMicrotask(()=>req.emit('error',Error('cancelled')));};requests.push({address,req});
    if(!options.hang)queueMicrotask(()=>{
      if(req.destroyed)return;
      const res=new EventEmitter();res.statusCode=options.status||200;res.resume=()=>{};callback(res);
      res.emit('data', options.body||Buffer.from([255,216,255,1]));res.emit('end');
    });
    return req;
  }};
  const env={fs,url:require('node:url'),http:client,https:client,now:()=>now,exit:()=>exits++,storage:()=>Promise.resolve({path:'/private',uri:'file:///private',icon:'file:///package/icon.png'}),publish:(data,success,failure)=>{published.push(JSON.parse(data));if(options.publishFailure)failure();else success();},setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  const service=createService(env);
  return {service,files,published,requests,timers,get exits(){return exits;},advance:ms=>now+=ms,run:data=>service.run(JSON.stringify(data),Preview.APP_ID)};
}
test('preview snapshots are bounded, spoiler-safe and omit tokens/URLs',()=>{
  const rows=Array.from({length:5},()=>({title:'Recent',items:Array.from({length:12},(_,i)=>({ratingKey:String(i),type:'episode',title:'Hidden spoiler',grandparentTitle:'Series',parentIndex:1,index:2,grandparentThumb:'/library/metadata/1/thumb',thumb:'https://external.invalid/image',token:'DO_NOT_EXPORT'}))}));
  const snapshot=Preview.snapshot(rows,scope,Features,{spoilerFree:true});
  assert.equal(snapshot.length,3);assert.equal(snapshot[0].tiles.length,6);
  const json=JSON.stringify(snapshot);assert.doesNotMatch(json,/Hidden spoiler|DO_NOT_EXPORT|external\.invalid/);assert.match(json,/Series/);
});
test('preview deep links accept only numeric metadata IDs in the current scope',()=>{
  assert.equal(Preview.deepLink(control({version:1,id:'42',scope}),scope),'42');
  for(const bad of [{version:1,id:'42',scope:'old'},{version:1,id:'https://other.invalid',scope},{version:1,id:'../../42',scope},{version:1,id:'42',scope,server:'ignored'}]){
    assert.equal(Preview.deepLink(control(bad),scope),bad.server?'42':null);
  }
  assert.equal(Preview.deepLink(control({version:1,id:'42',scope},'unrelated'),scope),null);
  assert.equal(Preview.deepLink({appControl:{operation:'http://samsung.com/appcontrol/operation/eden_resume',data:[{key:'PAYLOAD',value:['broken']}] }},scope),null);
});
test('preview service keeps credentials in request headers, publishes local images and never marks tiles playable',async()=>{
  const f=fixture();await f.run(payload());
  assert.equal(f.requests[0].address.headers['X-Plex-Token'],'PREVIEW_FIXTURE_ONLY');
  assert.doesNotMatch(f.requests[0].address.path,/PREVIEW_FIXTURE/);
  const output=f.published[0].sections[0].tiles[0];assert.equal(output.is_playable,false);assert.match(output.image_url,/^file:\/\/\/private\/preview-cache\/poster-/);
  assert.equal(JSON.parse(output.action_data).id,'42');assert.ok(output.display_until>0);
  assert.doesNotMatch(JSON.stringify(f.published),/PREVIEW_FIXTURE|192\.168/);
  for(const content of f.files.values())if(typeof content==='string')assert.doesNotMatch(content,/PREVIEW_FIXTURE|192\.168/);
  assert.equal(f.exits,1);assert.equal(f.timers.size,0);
});
test('preview rejects unrelated callers and malformed origins/paths before network work',async()=>{
  const f=fixture();await f.service.run(JSON.stringify(payload()),'AnotherApp.Foreground');
  assert.equal(f.requests.length,0);
  for(const mutate of [p=>p.server='https://user:pass@external.invalid',p=>p.server='https://external.invalid/path',p=>p.token='bad\r\nHeader',p=>p.sections[0].tiles[0].image='//external.invalid/image',p=>p.sections[0].tiles[0].image='/image?token=secret',p=>p.sections=Array(4).fill(p.sections[0])]){
    const data=payload();mutate(data);await f.run(data);
  }
  assert.equal(f.requests.length,0);assert.equal(f.published.length,0);
});
test('preview does not follow redirects and rejects non-images and oversized artwork',async()=>{
  for(const options of [{status:302},{body:Buffer.from('<html>not artwork</html>')},{body:Buffer.alloc(384*1024+1)}]){
    const f=fixture(options);await f.run(payload());assert.equal(f.requests.length,1);
    assert.equal(f.published[0].sections[0].tiles[0].title,'Open your library');
    assert.equal(Array.from(f.files.keys()).filter(k=>k.includes('poster-')).length,0);
  }
});
test('preview refresh is throttled; clearing removes cached artwork without storing credentials',async()=>{
  const f=fixture();await f.run(payload());await f.run(payload());assert.equal(f.published.length,1);
  await f.run({version:1,clear:true});assert.equal(f.published.length,1);
  assert.equal(Array.from(f.files.keys()).filter(k=>k.includes('poster-')).length,0);
  f.advance(600001);await f.run({version:1,clear:true});assert.equal(f.published[1].sections[0].tiles[0].title,'Open your library');
});
test('a clear request cancels pending artwork and prevents stale publication',async()=>{
  const f=fixture({hang:true});const old=f.run(payload());await new Promise(r=>setImmediate(r));
  await f.run({version:1,clear:true});await old;
  assert.equal(f.published.length,1);assert.equal(f.published[0].sections[0].tiles[0].title,'Open your library');assert.ok(f.requests[0].req.destroyed);
});
test('preview deadline closes slow requests and publication failure removes its artwork',async()=>{
  const slow=fixture({hang:true});const pending=slow.run(payload());await new Promise(r=>setImmediate(r));
  const deadline=Array.from(slow.timers.values()).find(timer=>timer.ms===20000);deadline.fn();await pending;
  assert.equal(slow.exits,1);assert.equal(slow.published.length,0);assert.equal(slow.timers.size,0);
  const failed=fixture({publishFailure:true});await failed.run(payload());
  assert.equal(Array.from(failed.files.keys()).filter(k=>k.includes('poster-')).length,0);assert.equal(failed.exits,1);
});
test('preview bridge checks capability and addresses only the bundled service',()=>{
  const calls=[],reports=[];const platform={systeminfo:{getCapability:()=>true},ApplicationControl:function(operation,uri,mime,category,data){Object.assign(this,{operation,data});},ApplicationControlData:function(key,value){Object.assign(this,{key,value});},application:{launchAppControl:(control,id,success)=>{calls.push({control,id});success();}}};
  const bridge=new Preview.Bridge(platform,message=>reports.push(message));bridge.send({version:1,clear:true});
  assert.equal(calls[0].id,Preview.SERVICE_ID);assert.equal(calls[0].control.operation,Preview.OPERATION);
  const unsupported=new Preview.Bridge({},message=>reports.push(message));unsupported.send(payload());assert.equal(calls.length,1);assert.equal(reports.length,1);
});

test('manifest keeps service identity inside the app package and cold-start polling exits without credentials',()=>{
  const vm=require('node:vm');
  const manifest=fs.readFileSync(require('node:path').join(__dirname,'../app/config.xml'),'utf8');
  assert.ok(manifest.includes('id="'+Preview.APP_ID+'"'));
  assert.ok(manifest.includes('id="'+Preview.SERVICE_ID+'" auto-restart="false"'));
  assert.ok(manifest.includes('required_version="5.0"'));
  let exits=0,required=[];
  const sandbox={module:{exports:{}},require:name=>{required.push(name);if(name==='./preview.js')return Preview;throw Error('Periodic launch must not initialize networking');},tizen:{application:{getCurrentApplication:()=>({getRequestedAppControl:()=>null,exit:()=>exits++})}}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../app/preview-service.js'),'utf8'),sandbox);
  sandbox.module.exports.onStart();sandbox.module.exports.onRequest();
  assert.equal(exits,1);assert.deepEqual(required,['./preview.js']);
});
