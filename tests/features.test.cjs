'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const F=require('../app/features');
test('preferences normalize Japanese tags and bound accessibility settings',()=>{
  const prefs=F.settings({audioLanguage:'jpn',subtitleLanguage:'ja-JP',subtitleSize:500,subtitleDelay:-20000,subtitleBackground:'invalid'});
  assert.equal(prefs.audioLanguage,'ja');assert.equal(prefs.subtitleLanguage,'ja');assert.equal(prefs.subtitleSize,96);assert.equal(prefs.subtitleDelay,-10000);assert.equal(prefs.subtitleBackground,'box');
});
test('language matching uses actual metadata, avoids commentary and never guesses an absent language',()=>{
  const tracks=[{index:7,languageCode:'jpn',commentary:true},{index:12,extra_info:'{"language":"ja"}'}];
  assert.equal(F.preferredTrack(tracks,'ja-JP').index,12);assert.equal(F.preferredTrack(tracks,'en'),null);
});
test('old TV subtitle languages are enriched only when ordering is supported by matching anchors',()=>{
  const av=['en  ','ar  ','un  ','ko  '].map((lang,index)=>({type:'TEXT',index:index+2,extra_info:JSON.stringify({track_lang:lang})}));
  const streams=['eng','ara','jpn','kor','tur'].map((languageCode,index)=>({id:index+1,streamType:3,index:index+3,codec:'srt',languageCode}));
  assert.equal(F.enrichTextTracks(av,streams)[2].languageCode,'jpn');
  const legacy=['en  ','jp  ','la  '].map((lang,index)=>({type:'TEXT',index:index+2,extra_info:JSON.stringify({track_lang:lang})}));
  const legacyStreams=['eng','jpn','lav','tur'].map((languageCode,index)=>({id:index+1,streamType:3,index:index+3,codec:'srt',languageCode}));
  assert.equal(F.enrichTextTracks(legacy,legacyStreams)[1].languageCode,'jpn');
  assert.equal(F.enrichTextTracks(legacy,legacyStreams)[2].languageCode,'lav');
  const mismatched=streams.map(x=>({...x}));mismatched[1].languageCode='deu';assert.equal(F.enrichTextTracks(av,mismatched)[2].languageCode,undefined);
});
test('unique Japanese remains native when unrelated old-TV language metadata disagrees',()=>{
 const av=['en','en','fr','jp'].map((track_lang,index)=>({type:'TEXT',index,extra_info:JSON.stringify({track_lang})}));
 const streams=['eng','eng','fin','jpn','tur'].map((languageCode,index)=>({streamType:3,index,id:100+index,codec:'srt',languageCode}));
 const result=F.enrichTextTracks(av,streams);
 assert.equal(F.trackLanguage(av[3]),'ja');assert.equal(result[3].plexId,103);
 assert.equal(result[2].plexId,undefined);assert.equal(result[0].plexId,undefined);
 const duplicate=streams.concat({...streams[3],id:200,index:6});assert.equal(F.enrichTextTracks(av,duplicate)[3].plexId,undefined);
});
test('search filters are encoded and sort keys are allowlisted',()=>{
  const url=new URL(F.libraryPath('2',{title:'日本語 & title',sort:'bad',genre:'5',year:'2024',unwatched:true}),'http://test');
  assert.equal(url.pathname,'/library/sections/2/all');assert.equal(url.searchParams.get('title'),'日本語 & title');assert.equal(url.searchParams.get('sort'),'titleSort:asc');assert.equal(url.searchParams.get('unwatched'),'1');
});
test('automatic subtitles prefer equivalent text without losing forced or hearing-impaired choices',()=>{
 const image={id:1,codec:'pgs',languageCode:'zho'},text={id:2,codec:'srt',languageCode:'zho'},forced={id:3,codec:'pgs',languageCode:'zho',forced:true},sdh={id:4,codec:'pgs',languageCode:'zho',hearingImpaired:true};
 assert.equal(F.preferredSubtitle([image,text],'zh').id,2);
 assert.equal(F.preferredSubtitle([image,forced,text],'zh',{forced:true}).id,3);
 assert.equal(F.preferredSubtitle([image,sdh,text],'zh',{hearingImpaired:true}).id,4);
 assert.equal(F.preferredSubtitle([image],'zh').id,1);
 assert.equal(F.preferredSubtitle([image,text],'ja'),null);
});
test('direct play adds no decision step; known incompatible audio goes straight to fallback',()=>{
  assert.deepEqual(F.playbackModes({Media:[{audioCodec:'aac'}]},F.settings()),['direct','remux','convert']);
  assert.deepEqual(F.playbackModes({Media:[{audioCodec:'dca'}]},F.settings()),['remux','convert']);
  assert.deepEqual(F.playbackModes({},F.settings({playbackMode:'direct'})),['direct']);
  assert.equal(F.playbackModes({Media:[{audioCodec:'truehd',Part:[{Stream:[{streamType:2,codec:'truehd'},{streamType:2,codec:'ac3'}]}]}]},F.settings())[0],'direct');
  assert.equal(F.playbackModes({Media:[{audioCodec:'dca-ma',Part:[{Stream:[{streamType:2,codec:'dca'},{streamType:2,codec:'dca'}]}]}]},F.settings())[0],'remux');
});
test('fallback parameters keep unique sessions and distinguish video preservation from conversion',()=>{
  const first=F.transcodeParams({ratingKey:'42'},'remux','session-a','client');
  const second=F.transcodeParams({ratingKey:'42'},'convert','session-b','client');
  assert.equal(first.directStream,1);assert.equal(second.directStream,0);assert.equal(first.directStreamAudio,0);assert.equal(first.session,'session-a');assert.equal(second.session,'session-b');assert.equal(first.subtitles,'none');
});
test('preview extraction is conditional and uses milliseconds, with no whole-BIF download',()=>{
  assert.equal(F.previewPath({Media:[{Part:[{id:4,indexes:'sd'}]}]},12345),'/library/parts/4/indexes/sd/12000');
  assert.equal(F.previewPath({Media:[{Part:[{id:4}]}]},12345),'');
});

test('show preferences preserve language and accessibility traits but never track indexes',()=>{
 const pref=F.showPreferences({audioLanguage:'jpn',subtitleLanguage:'en',subtitleMode:'always',audioTraits:{index:17,commentary:true},subtitleTraits:{id:999,hearingImpaired:true}});
 assert.equal(pref.audioLanguage,'ja');assert.equal(pref.audioTraits.index,undefined);assert.equal(pref.subtitleTraits.id,undefined);
 const tracks=[{index:40,languageCode:'en'},{index:90,languageCode:'en',hearingImpaired:true}];
 assert.equal(F.preferredTrack(tracks,'en',pref.subtitleTraits).index,90);
 assert.equal(F.preferredTrack(tracks,'ja',pref.subtitleTraits),null);
});
test('spoiler protection applies only to unwatched episodes and respects the profile switch',()=>{
 assert.equal(F.hideSpoiler({type:'episode',viewCount:0},F.settings()),true);
 assert.equal(F.hideSpoiler({type:'episode',viewCount:1},F.settings()),false);
 assert.equal(F.hideSpoiler({type:'movie'},F.settings()),false);
 assert.equal(F.hideSpoiler({type:'episode'},F.settings({spoilerFree:false})),false);
});

test('saved library filters are bounded and invalid sorting falls back safely',()=>{
 const saved=F.libraryFilters({title:'  '+ 'x'.repeat(150)+' ',genre:'g'.repeat(200),year:'2025',sort:'unsafe',unwatched:'true'});
 assert.equal(saved.title.length,100);assert.equal(saved.genre.length,100);assert.equal(saved.sort,'titleSort:asc');assert.equal(saved.unwatched,false);
 assert.equal(F.hasLibraryFilters({}),false);assert.equal(F.hasLibraryFilters({sort:'addedAt:desc'}),true);
});

test('filter summary uses readable saved labels and the same validated values as the request',()=>{
 const filters=F.libraryFilters({title:'  日本語 & 中文  ',genre:'17',genreLabel:'Science fiction',year:'2025',sort:'addedAt:desc',unwatched:true});
 assert.equal(F.filterSummary(filters),'Title: 日本語 & 中文 · Unwatched · Science fiction · 2025 · Recently added');
 assert.equal(F.filterSummary(JSON.parse(JSON.stringify(filters))),F.filterSummary(filters));
 const query=new URL(F.libraryPath('1',filters),'http://test').searchParams;
 assert.equal(query.get('title'),'日本語 & 中文');assert.equal(query.get('genre'),'17');assert.equal(query.get('unwatched'),'1');
 assert.equal(query.has('genreLabel'),false);assert.equal(query.has('yearLabel'),false);
 assert.equal(F.filterSummary(filters,{genre:{17:'科学幻想'}}),'Title: 日本語 & 中文 · Unwatched · 科学幻想 · 2025 · Recently added');
});

test('filter summaries never invent labels for opaque IDs or accept inherited saved fields',()=>{
 assert.equal(F.filterSummary({genre:'17',year:'opaque'}),'Genre selected · Year selected · Title A–Z');
 assert.equal(F.filterSummary({genre:'constructor',year:'2024'},{genre:{}}),'Genre selected · 2024 · Title A–Z');
 assert.equal(F.filterSummary({genre:'17',genreLabel:'Old label'},{genre:Object.create({17:'Inherited label'})}),'Old label · Title A–Z');
 const inherited=Object.create({title:'Hidden query',genre:'17',unwatched:true,sort:'rating:desc'});
 assert.equal(F.filterSummary(inherited),'Title A–Z');
 assert.equal(F.hasLibraryFilters(inherited),false);
 assert.equal(new URL(F.libraryPath('1',inherited),'http://test').searchParams.toString(),'sort=titleSort%3Aasc');
 assert.equal(F.filterSummary({title:{bad:true},genre:{bad:true},year:NaN,sort:'__proto__',genreLabel:'Orphaned label'}),'Title A–Z');
 assert.equal(F.filterSummary({sort:'year:desc'}),'Newest release');
 assert.equal(F.filterSummary({sort:'rating:desc'}),'Highest rated');
});

test('recent searches retain the five latest distinct submitted titles without mutating caller state',()=>{
 const original=['Batman','日本語','中文','Fourth','Fifth'];
 assert.deepEqual(F.addRecentSearch(original,'  batman  '),['batman','日本語','中文','Fourth','Fifth']);
 assert.deepEqual(original,['Batman','日本語','中文','Fourth','Fifth']);
 assert.deepEqual(F.addRecentSearch(original,'Sixth'),['Sixth','Batman','日本語','中文','Fourth']);
 assert.deepEqual(F.addRecentSearch(original,'  '),original);
 assert.deepEqual(F.recentSearches(['First','FIRST','',null,{title:'bad'},3,'日本語','中文','Fourth','Fifth','Sixth']),['First','日本語','中文','Fourth','Fifth']);
});

test('recent search sanitation preserves CJK and supplementary characters and rejects malformed storage',()=>{
 const title='𠮷'.repeat(101),normalized=F.recentSearches([title])[0];
 assert.equal([...normalized].length,100);assert.equal(normalized,'𠮷'.repeat(100));
 assert.equal(F.libraryFilters({title}).title,normalized);
 assert.deepEqual(F.recentSearches(['  日本語\n中文\u0000  ','\ud800','\udfff']),['日本語 中文']);
 for(const invalid of [null,{},'Batman',17,Object.create({0:'Batman',length:1})])assert.deepEqual(F.recentSearches(invalid),[]);
 assert.deepEqual(F.recentSearches([]),[]);
 const saved=F.addRecentSearch(['Older'],'Newest');
 assert.deepEqual(F.recentSearches(JSON.parse(JSON.stringify(saved))),['Newest','Older']);
 assert.deepEqual(F.addRecentSearch([],undefined),[]);
});

test('watched card state distinguishes a completed watch, partial watch and rewatch',()=>{
 assert.deepEqual(F.cardWatchState({viewCount:1,duration:10000}),{watched:true,inProgress:false,showWatched:true,position:0,duration:10000,progress:null,remaining:null});
 const partial=F.cardWatchState({duration:10000,viewOffset:2500});
 assert.equal(partial.watched,false);assert.equal(partial.inProgress,true);assert.equal(partial.progress,0.25);assert.equal(partial.remaining,7500);
 const rewatch=F.cardWatchState({viewCount:1,duration:10000,viewOffset:2500});
 assert.equal(rewatch.watched,true);assert.equal(rewatch.showWatched,false);assert.equal(rewatch.progress,0.25);
 assert.equal(F.cardWatchState({viewCount:1,duration:10000,viewOffset:99999}).showWatched,true);
 assert.equal(F.cardWatchState({viewCount:0,duration:10000,viewOffset:0}).showWatched,false);
});

test('watched card state keeps unknown duration honest and bounds malformed metadata',()=>{
 const unknown=F.cardWatchState({viewOffset:2000});
 assert.equal(unknown.inProgress,true);assert.equal(unknown.progress,null);assert.equal(unknown.remaining,null);
 for(const item of [null,{}, {duration:Infinity,viewOffset:NaN,viewCount:Infinity}, {duration:-1,viewOffset:-1,viewCount:-1},Object.create({viewCount:1,viewOffset:500,duration:1000})]){
  assert.deepEqual(F.cardWatchState(item),{watched:false,inProgress:false,showWatched:false,position:0,duration:0,progress:null,remaining:null});
 }
});

test('completed show and season episode counts yield watched badges without inventing time progress',()=>{
 for(const item of [{type:'show',leafCount:24,viewedLeafCount:24},{type:'season',leafCount:'12',viewedLeafCount:'12'},{type:'show',leafCount:2,viewedLeafCount:3}]){
  assert.deepEqual(F.cardWatchState(item),{watched:true,inProgress:false,showWatched:true,position:0,duration:0,progress:null,remaining:null});
 }
 for(const type of ['show','season']){
  const partial=F.cardWatchState({type,leafCount:12,viewedLeafCount:6});
  assert.equal(partial.watched,false);assert.equal(partial.inProgress,false);assert.equal(partial.progress,null);assert.equal(partial.remaining,null);
 }
 for(const type of ['movie','episode',undefined])assert.equal(F.cardWatchState({type,leafCount:1,viewedLeafCount:1}).watched,false);
});

test('empty, missing and malformed show episode counts cannot imply completion',()=>{
 const counts=[{leafCount:0,viewedLeafCount:0},{leafCount:0,viewedLeafCount:2},{leafCount:12},{viewedLeafCount:12},
  {leafCount:-1,viewedLeafCount:12},{leafCount:12,viewedLeafCount:-1},{leafCount:Infinity,viewedLeafCount:Infinity},
  {leafCount:NaN,viewedLeafCount:12},{leafCount:12,viewedLeafCount:Infinity},{leafCount:1.5,viewedLeafCount:2},
  {leafCount:1,viewedLeafCount:1.5},{leafCount:true,viewedLeafCount:true},{leafCount:[1],viewedLeafCount:[1]},
  {leafCount:'',viewedLeafCount:''},{leafCount:'bad',viewedLeafCount:'bad'},Object.create({leafCount:12,viewedLeafCount:12})];
 for(const values of counts){
  const item=Object.create(Object.getPrototypeOf(values));Object.assign(item,values,{type:'show'});
  const state=F.cardWatchState(item);assert.equal(state.watched,false);assert.equal(state.showWatched,false);assert.equal(state.progress,null);assert.equal(state.remaining,null);
 }
});
