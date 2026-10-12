'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../app/subtitles');
test('Japanese SRT and Chinese WebVTT retain Unicode and normalize timing',()=>{
  const srt=S.parse('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n日本語：ひらがな カタカナ 漢字\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n中文字幕：简体與繁體\r\n');
  assert.equal(S.at(srt,1249),'');assert.match(S.at(srt,1250),/日本語/);assert.equal(S.at(srt,3500),'');assert.match(S.at(srt,4500),/简体/);
  const vtt=S.parse('WEBVTT\n\ncue1\n00:01.000 --> 00:03.000 align:center\n<b>日本語</b> &amp; 中文');
  assert.equal(S.at(vtt,2000),'日本語 & 中文');
});
test('subtitle markup stays inert and overlap works when seeking backward',()=>{
  const cues=S.parse('1\n00:00:01,000 --> 00:00:10,000\n長い字幕\n\n2\n00:00:02,000 --> 00:00:03,000\n<script>alert(1)</script>\n');
  assert.equal(S.at(cues,5000),'長い字幕');assert.equal(S.at(cues,2500),'長い字幕\nalert(1)');assert.equal(S.at(cues,500),'');
  assert.equal(S.clean('{\\an8}Line\\Nnext'),'Line\nnext');
});
test('malformed cues and excessive files fail without unbounded rendering',()=>{
  assert.deepEqual(S.parse('not a subtitle\n\n1\n00:00:04,000 --> 00:00:02,000\nbad'),[]);
  assert.throws(()=>S.parse('x'.repeat(8*1024*1024+1)),/too large/);
});
test('large cue lists support random seeks accurately',()=>{
  const text=Array.from({length:10000},(_,i)=>{const ms=i*2000;function stamp(n){return String(Math.floor(n/3600000)).padStart(2,'0')+':'+String(Math.floor(n/60000)%60).padStart(2,'0')+':'+String(Math.floor(n/1000)%60).padStart(2,'0')+',000';}return i+'\n'+stamp(ms)+' --> '+stamp(ms+1000)+'\n日本語 '+i;}).join('\n\n');
  const cues=S.parse(text);assert.equal(cues.length,10000);assert.equal(S.at(cues,19998500),'日本語 9999');assert.equal(S.at(cues,2000500),'日本語 1000');
});
test('incremental subtitles render complete cues without reparsing unfinished Unicode blocks',()=>{
  const parser=new S.StreamParser(),first='1\n00:00:01,000 --> 00:00:02,000\n日本語\n\n';
  parser.feed(first+'2\n00:00:03,000',false);assert.equal(S.at(parser.cues,1500),'日本語');assert.equal(parser.cues.length,1);
  parser.feed(first+'2\n00:00:03,000 --> 00:00:04,000\n中文字幕',true);assert.equal(parser.cues.length,2);assert.equal(S.at(parser.cues,3500),'中文字幕');
});
