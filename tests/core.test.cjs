'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../app/core.js');

test('server URL accepts LAN and HTTPS addresses without changing transport policy', () => {
  assert.equal(C.normalizeServer(' http://192.168.1.20:32400/ '), 'http://192.168.1.20:32400');
  assert.equal(C.normalizeServer('https://server.example:32400'), 'https://server.example:32400');
});
test('server setup rejects localhost, embedded credentials, and web UI URLs', () => {
  for (const url of ['http://localhost:32400', 'http://127.0.0.1:32400', 'http://[::1]:32400', 'http://user:secret@server:32400', 'http://192.168.1.20:32400/web', 'ftp://server', 'http://server?token=secret']) {
    assert.throws(() => C.normalizeServer(url));
  }
});
test('media URLs retain the configured origin and encode credentials', () => {
  assert.equal(C.mediaURL('http://192.168.1.20:32400', '/library/parts/1/file.mkv', 'a&b'), 'http://192.168.1.20:32400/library/parts/1/file.mkv?X-Plex-Token=a%26b');
  for (const path of ['https://other.test/file', '//other.test/file', '/\\other.test', '/\n/other.test/file', '/\t/other.test/file', undefined]) assert.throws(() => C.mediaURL('http://server', path, 'secret'));
});
test('metadata parser supports directories and preserves pagination totals', () => {
  assert.deepEqual(C.extract({MediaContainer:{Directory:[{key:'1'}],totalSize:90}}), {items:[{key:'1'}],total:90});
  assert.deepEqual(C.extract({MediaContainer:{Metadata:[],size:0}}), {items:[],total:0});
});
test('unplayable and multipart metadata cannot silently play the wrong segment', () => {
  assert.throws(() => C.primaryPart({}));
  assert.throws(() => C.primaryPart({Media:[{Part:[{},{}]}]}));
  assert.equal(C.primaryPart({Media:[{Part:[{key:'/part'}]}]}).part.key, '/part');
});
test('diagnostic text does not expose tokens or playback URLs', () => {
  const secret = 'TEST_SECRET_123';
  for (const msg of ['failed https://example/video?X-Plex-Token='+secret, 'X-Plex-Token='+secret, 'authToken: '+secret]) assert.equal(C.safeError(msg).includes(secret), false);
});
test('duration formatting handles zero, hours and negative values', () => {
  assert.equal(C.duration(0),'0:00'); assert.equal(C.duration(3661000),'1:01:01'); assert.equal(C.duration(-1),'0:00');
});
test('track labels use audio and subtitle language fields with safe fallbacks', () => {
  assert.equal(C.trackLabel({type:'AUDIO',extra_info:'{"language":"tr","channels":"6","fourCC":"AC3"}'},1),'Audio 2 · Turkish · AC3 · 6 channels');
  assert.equal(C.trackLabel({type:'TEXT',extra_info:'{"track_lang":"eng"}'},0),'Subtitle 1 · English');
  assert.equal(C.trackLabel({type:'TEXT',extra_info:'invalid'},2),'Subtitle 3 · Language unknown');
  assert.equal(C.trackLabel({type:'AUDIO',extra_info:'null'},0),'Audio 1 · Language unknown');
});
