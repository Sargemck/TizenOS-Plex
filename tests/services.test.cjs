'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../app/core');
const Service=require('../app/services');
test('discovery verifies machine identity before sending a server-scoped token',async()=>{
  const calls=[];
  const service=new Service({normalizeServer:C.normalizeServer,request(url,options){calls.push({url,options});return Promise.resolve(url.endsWith('/identity')?{MediaContainer:{machineIdentifier:'correct'}}:{MediaContainer:{Directory:[]}});}},()=>({'X-Plex-Client-Identifier':'fixture'}));
  const result=await service.connectResource({clientIdentifier:'correct',accessToken:'SCOPED_TEST',connections:[{local:true,uri:'http://192.168.1.20:32400'}]});
  assert.equal(calls[0].options.headers,undefined);assert.equal(calls[1].options.headers['X-Plex-Token'],'SCOPED_TEST');assert.equal(result.machineId,'correct');
});
test('wrong identities, relay and non-local addresses receive no credentials',async()=>{
  const calls=[];
  const service=new Service({normalizeServer:C.normalizeServer,request(url,options){calls.push({url,options});return Promise.resolve({MediaContainer:{machineIdentifier:'wrong'}});}},()=>({}));
  await assert.rejects(service.connectResource({clientIdentifier:'correct',accessToken:'SCOPED_TEST',connections:[{local:true,uri:'http://192.168.1.20:32400'},{local:false,uri:'https://remote.test'},{local:true,relay:true,uri:'https://relay.test'},{local:'0',uri:'https://notlocal.test'}]}),/No local connection/);
  assert.equal(calls.length,1);assert.equal(calls[0].options.headers,undefined);
});
test('cloud resources use the supplied active-user token rather than a server token',async()=>{
  let observed;
  const service=new Service({request(url,options){observed={url,options};return Promise.resolve([{provides:'server',accessToken:'SCOPED'},{provides:'player',accessToken:'PLAYER'}]);}},()=>({'X-Plex-Product':'Fixture'}));
  const resources=await service.resources('ACTIVE_USER');assert.equal(resources.length,1);assert.equal(observed.options.headers['X-Plex-Token'],'ACTIVE_USER');assert.equal(new URL(observed.url).hostname,'plex.tv');
});

test('next episode preserves server ordering and crosses a season boundary without starting playback',async()=>{
 const service=new Service(C,()=>({})),calls=[];
 const responses={'/library/metadata/10/children':[{type:'episode',ratingKey:'100'}],'/library/metadata/1/children':[{type:'season',ratingKey:'10'},{type:'season',ratingKey:'20'}],'/library/metadata/20/children':[{type:'episode',ratingKey:'200'}]};
 const next=await service.nextEpisode({type:'episode',ratingKey:'100',parentRatingKey:'10',grandparentRatingKey:'1'},url=>{calls.push(url);return Promise.resolve({MediaContainer:{Metadata:responses[url.split('?')[0]]}});});
 assert.equal(next.ratingKey,'200');assert.equal(calls.length,3);
});
test('next episode finds the successor across a paginated season',async()=>{
 const service=new Service(C,()=>({}));let calls=0;
 const next=await service.nextEpisode({type:'episode',ratingKey:'99',parentRatingKey:'10',grandparentRatingKey:'1'},url=>{calls++;const start=Number(new URL(url,'http://fixture').searchParams.get('X-Plex-Container-Start'));return Promise.resolve({MediaContainer:{totalSize:101,Metadata:Array.from({length:start?1:100},(_,i)=>({type:'episode',ratingKey:String(start+i)}))}});});
 assert.equal(next.ratingKey,'100');assert.equal(calls,2);
});
test('cancelling next-episode lookup prevents a late reply from advancing to another season',async()=>{
 const service=new Service(C,()=>({}));let resolveRequest,aborted=false,calls=0;
 const lookup=service.nextEpisode({type:'episode',ratingKey:'99',parentRatingKey:'10',grandparentRatingKey:'1'},()=>{calls++;const p=new Promise(resolve=>resolveRequest=resolve);p.abort=()=>aborted=true;return p;});
 await Promise.resolve();lookup.abort();resolveRequest({MediaContainer:{Metadata:[{type:'episode',ratingKey:'99'}]}});
 await assert.rejects(lookup,error=>error.cancelled===true);assert.equal(calls,1);assert.equal(aborted,true);
});

test('series continuation uses Plex OnDeck without additional requests',async()=>{
 const service=new Service(C,()=>({})),episode={type:'episode',ratingKey:'12',grandparentRatingKey:'1',viewOffset:120000};
 const result=await service.continueSeries({ratingKey:'1',OnDeck:{Metadata:[episode]}},()=>{throw Error('Unexpected lookup');});
 assert.equal(result,episode);
});
test('series fallback is show scoped, ordered, paginated and rejects another show recommendation',async()=>{
 const service=new Service(C,()=>({})),calls=[];
 const result=await service.continueSeries({ratingKey:'1',OnDeck:{Metadata:[{type:'episode',ratingKey:'99',grandparentRatingKey:'2'}]}},url=>{
  calls.push(url);const start=Number(new URL(url,'http://fixture').searchParams.get('X-Plex-Container-Start'));
  return Promise.resolve({MediaContainer:{totalSize:25,Metadata:start?[{type:'episode',ratingKey:'25',grandparentRatingKey:'1',viewCount:0}]:Array.from({length:24},(_,i)=>({type:'episode',ratingKey:String(i),grandparentRatingKey:'1',viewCount:1}))}});
 });
 assert.equal(result.ratingKey,'25');assert.equal(calls.length,2);assert.ok(calls.every(url=>url.startsWith('/library/metadata/1/allLeaves?unwatched=1&sort=parentIndex,index')));
});
test('series fallback has a bounded request budget and all-watched series has no automatic replay',async()=>{
 const service=new Service(C,()=>({}));let calls=0;
 const result=await service.continueSeries({ratingKey:'1'},()=>Promise.resolve({MediaContainer:{Metadata:[{type:'episode',ratingKey:'12',grandparentRatingKey:'1',viewCount:1}],totalSize:1}}));assert.equal(result,null);
 await assert.rejects(service.continueSeries({ratingKey:'1'},()=>{calls++;return Promise.resolve({MediaContainer:{Metadata:Array.from({length:24},(_,i)=>({type:'episode',ratingKey:String(i),grandparentRatingKey:'1',viewCount:1})),totalSize:10000}});}),/Choose an episode/);assert.equal(calls,10);
});
test('series cancellation ignores late progress results and aborts the network request',async()=>{
 const service=new Service(C,()=>({}));let resolveRequest,aborted=false;
 const lookup=service.continueSeries({ratingKey:'1'},()=>{const p=new Promise(resolve=>resolveRequest=resolve);p.abort=()=>aborted=true;return p;});
 await Promise.resolve();lookup.abort();resolveRequest({MediaContainer:{Metadata:[{type:'episode',ratingKey:'12',grandparentRatingKey:'1'}]}});
 await assert.rejects(lookup,error=>error.cancelled===true);assert.equal(aborted,true);
});
