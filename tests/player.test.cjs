'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Player = require('../app/player.js');
function fixture() {
  const calls=[], reports=[], timers=new Map(); let count=0;
  const clock={setTimeout(fn){timers.set(++count,fn);return count;},clearTimeout(id){timers.delete(id);},setInterval(fn){timers.set(++count,fn);return count;},clearInterval(id){timers.delete(id);}};
  const av={open(){calls.push('open');},setDisplayRect(){},setDisplayMethod(){},setListener(v){this.listener=v;},prepareAsync(ok,bad){this.ready=ok;this.bad=bad;},getDuration(){return 600000;},play(){calls.push('play');},pause(){calls.push('pause');},seekTo(ms,ok,bad){calls.push('seek:'+ms);this.seekOK=ok;this.seekBad=bad;},stop(){calls.push('stop');},close(){calls.push('close');},getTotalTrackInfo(){return [{type:'AUDIO',index:0},{type:'TEXT',index:1}];},setSilentSubtitle(){},setSelectTrack(){}};
  const errors=[];
  const p=new Player(av,{report(...args){reports.push(args);},error(e){errors.push(e);}},clock);
  const open=(offset=0)=>p.open('http://fixture/file',{ratingKey:'1',duration:600000},offset);
  return {p,av,calls,reports,errors,timers,open};
}
test('failed preparation never overwrites the saved resume position',()=>{
  const f=fixture(); f.open(123000); f.av.bad(new Error('Unsupported format'));
  assert.equal(f.reports.length,0); assert.equal(f.p.active,false); assert.equal(f.errors.length,1); assert.equal(f.timers.size,0);
});
test('late callbacks cannot restart a stopped video or affect a later session',()=>{
  const f=fixture();f.open();const oldReady=f.av.ready,oldListener=f.av.listener;f.p.stop();f.open();oldReady();oldListener.onerror('late');
  assert.equal(f.p.active,true);assert.equal(f.calls.includes('play'),false);assert.equal(f.errors.length,0);f.av.ready();assert.equal(f.p.started,true);
});
test('resume waits for the seek callback before invoking another AVPlay API',()=>{
  const f=fixture(); f.open(120000); f.av.ready();assert.equal(f.calls.includes('play'),false);
  f.p.toggle();assert.equal(f.calls.includes('pause'),false);
  f.av.seekOK();assert.equal(f.calls.at(-1),'play');assert.equal(f.reports[0][2],120000);
});
test('Back during a seek defers cleanup and does not play after the seek returns',()=>{
  const f=fixture();f.open(10000);f.av.ready();f.p.stop();assert.equal(f.calls.includes('stop'),false);
  f.av.seekOK();assert.equal(f.p.active,false);assert.equal(f.calls.includes('play'),false);assert.equal(f.reports.length,0);
});
test('failed resume preserves watch position instead of silently starting from zero',()=>{
  const f=fixture();f.open(20000);f.av.ready();f.av.seekBad(new Error('Seek failed'));
  assert.equal(f.reports.length,0);assert.equal(f.p.active,false);assert.match(f.errors[0].message,/Resume failed/);
});
test('pause and stop report actual progress, and clean up the player',()=>{
  const f=fixture();f.open();f.av.ready();f.av.listener.oncurrentplaytime(25000);f.p.toggle();f.p.stop();
  assert.equal(f.reports.at(-2)[1],'paused');assert.equal(f.reports.at(-1)[1],'stopped');assert.equal(f.reports.at(-1)[2],25000);assert.equal(f.timers.size,0);
});
test('completion sends the final position to Plex',()=>{
  const f=fixture();f.open();f.av.ready();f.av.listener.onstreamcompleted();assert.equal(f.reports.at(-1)[2],600000);assert.equal(f.p.active,false);
});
test('only natural completion emits a completed stop, including deferred completion during seek',()=>{
  const f=fixture(),stopped=[];f.p.events.stopped=result=>stopped.push(result);
  f.open();f.av.ready();f.p.stop();assert.deepEqual(stopped.pop(),{completed:false});
  f.open();f.av.ready();f.av.listener.onstreamcompleted();assert.deepEqual(stopped.pop(),{completed:true});
  f.open();f.av.ready();f.p.seek(599000);f.av.listener.onstreamcompleted();assert.equal(stopped.length,0);
  f.av.seekOK();assert.deepEqual(stopped.pop(),{completed:true});assert.equal(f.p.active,false);
  f.open();f.av.ready();f.p.seek(599000);f.p.stop();f.av.listener.onstreamcompleted();f.av.seekOK();
  assert.deepEqual(stopped.pop(),{completed:false},'An explicit Stop already pending takes precedence');
});
test('preparation watchdog leaves the app able to open another file',()=>{
  const f=fixture();f.open();Array.from(f.timers.values())[0]();assert.equal(f.p.active,false);assert.match(f.errors[0].message,/timed out/);f.open();assert.equal(f.p.active,true);
});
test('track selection uses AVPlay indexes and keeps subtitle-off state explicit',()=>{
  const f=fixture();f.open();f.av.ready();
  f.av.getCurrentStreamInfo=()=>[{type:'AUDIO',index:7},{type:'TEXT',index:15}];
  f.av.setSelectTrack=(type,index)=>f.calls.push(type+':'+index);
  f.av.setSilentSubtitle=value=>f.calls.push('silent:'+value);
  assert.equal(f.p.currentTrack('AUDIO'),7);
  f.p.selectTrack('TEXT',15);assert.deepEqual(f.calls.slice(-2),['TEXT:15','silent:false']);
  f.p.selectTrack('TEXT',-1);assert.equal(f.p.currentTrack('TEXT'),-1);
  assert.equal(f.calls.at(-1),'silent:true');
  f.p.stop();f.open();f.av.ready();assert.equal(f.p.currentTrack('TEXT'),15);
});
test('track choices fail visibly while seeking or when audio is paused',()=>{
  const f=fixture();f.open();f.av.ready();f.p.toggle();
  assert.throws(()=>f.p.selectTrack('AUDIO',7),/Resume playback/);
  f.p.seek(60000);assert.throws(()=>f.p.selectTrack('TEXT',15),/seeking/);
  f.av.seekOK();
});

test('native Unicode subtitle callbacks render only while subtitles are enabled',()=>{
  const f=fixture(),rendered=[];f.p.events.subtitle=text=>rendered.push(text);f.open();f.av.ready();
  f.p.selectTrack('TEXT',1);f.av.listener.onsubtitlechange(2000,'日本語・中文字幕','0');
  assert.equal(rendered.at(-1),'日本語・中文字幕');
  f.p.selectTrack('TEXT',-1);f.av.listener.onsubtitlechange(2000,'hidden','0');assert.equal(rendered.at(-1),'');
  f.p.stop();f.av.listener.onsubtitlechange(2000,'stale','0');assert.equal(rendered.at(-1),'');
});
test('large forward and backward seeks stay inside the media duration',()=>{
  const f=fixture();f.open();f.av.ready();
  f.p.seek(620000);assert.equal(f.calls.at(-1),'seek:599000');f.av.seekOK();
  f.p.seek(-1000);assert.equal(f.calls.at(-1),'seek:0');f.av.seekOK();
});
test('native subtitle lifetime pauses with video, resumes remaining time, and clears on seek',()=>{
 const f=fixture(),rendered=[];let now=0;f.p.clock.now=()=>now;f.p.events.subtitle=t=>rendered.push(t);f.open();f.av.ready();
 f.av.listener.onsubtitlechange(5000,'Japanese caption','0');const old=f.p.subtitleTimer,stale=f.timers.get(old);
 now=1000;f.p.toggle();assert.equal(f.timers.has(old),false,'Pausing must cancel wall-clock subtitle expiry');
 now=21000;f.p.toggle();assert.equal(rendered.at(-1),'Japanese caption');assert.equal(f.p.subtitleRemaining,4000);
 stale();assert.equal(rendered.at(-1),'Japanese caption','A queued pre-pause timer cannot erase resumed text');
 f.timers.get(f.p.subtitleTimer)();assert.equal(rendered.at(-1),'');
 f.av.listener.onsubtitlechange(5000,'Another caption','0');f.p.seek(100000);assert.equal(rendered.at(-1),'');assert.equal(f.p.subtitleRemaining,0);
});
test('seek watchdog releases the player when the TV never calls back',()=>{
  const f=fixture();f.open();f.av.ready();f.p.seek(90000);f.p.stop();
  const watchdog=Array.from(f.timers.values()).at(-1);watchdog();
  assert.equal(f.p.active,false);assert.match(f.errors.at(-1).message,/Seeking timed out/);assert.equal(f.timers.size,0);
  f.av.seekOK();assert.equal(f.p.active,false);
});

test('a buffering timeout retains the last playback position for recovery',()=>{
 const f=fixture();let failure;f.p.events.error=(error,context)=>failure={error,context};f.open();f.av.ready();f.av.listener.oncurrentplaytime(123000);f.av.listener.onbufferingstart();
 f.timers.get(f.p.bufferTimer)();assert.equal(f.p.active,false);assert.equal(failure.context.time,123000);assert.equal(failure.context.started,true);assert.match(failure.error.message,/buffering timed out/);assert.equal(f.timers.size,0);
});
test('buffer watchdog follows progress, pauses safely, and ignores stale sessions',()=>{
 const f=fixture();f.open();f.av.ready();f.av.listener.onbufferingstart();const old=f.timers.get(f.p.bufferTimer),timer=f.p.bufferTimer;
 f.av.listener.oncurrentplaytime(10000);assert.equal(f.timers.has(timer),false);
 f.p.toggle();assert.equal(f.timers.has(f.p.bufferTimer),false);f.p.toggle();assert.equal(f.timers.has(f.p.bufferTimer),true);
 f.av.listener.onbufferingcomplete();assert.equal(f.timers.has(f.p.bufferTimer),false);
 f.p.stop();f.open();f.av.ready();old();assert.equal(f.p.active,true);assert.equal(f.errors.length,0);
});
