'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
test('release metadata and actual Plex request headers agree on the version',()=>{
  const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json')),app=read('app/app.js');
  const runtime=app.match(/var APP_VERSION = '([^']+)'/)[1];
  const widget=read('app/config.xml').match(/<widget\b[^>]*\bversion="([^"]+)"/)[1];
  const visible=read('app/index.html').match(/Preview ([0-9.]+)/)[1];
  assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
  for(const actual of [runtime,widget,visible,lock.version,lock.packages[''].version])assert.equal(actual,pkg.version);
  const headerFunction=app.match(/  function headers\(auth\) \{[\s\S]*?\n  \}/)[0];
  const headers=vm.runInNewContext('var APP_VERSION='+JSON.stringify(runtime)+';var clientId="FIXTURE_CLIENT",serverToken="FIXTURE_TOKEN";'+headerFunction+';headers(false)');
  assert.equal(headers['X-Plex-Version'],pkg.version);assert.equal(headers['X-Plex-Token'],undefined);
  assert.equal(pkg.private,true,'GitHub source is public; npm publication remains disabled');
});
test('installer runtime allowlist includes exactly the source assets',()=>{
  const allowed=read('Install-TV.ps1').match(/\$AllowedFiles = @\(([^\r\n]+)\)/)[1].match(/'[^']+'/g).map(value=>value.slice(1,-1)).sort();
  const actual=fs.readdirSync(path.join(root,'app'),{withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>entry.name).sort();
  assert.deepEqual(allowed,actual);
  assert.match(read('app/config.xml'),/required_version="5\.0"/);
});
test('packaged license matches the root license and preserves separate font licensing',()=>{
  assert.equal(read('app/LICENSE'),read('LICENSE'));
  assert.match(read('LICENSE'),/MIT License/);
  assert.match(read('app/font-license.txt'),/SIL OPEN FONT LICENSE Version 1\.1/);
});
