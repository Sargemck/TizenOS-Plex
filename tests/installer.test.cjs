'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, '.local', 'installer-tests');
fs.mkdirSync(scratch, {recursive:true});

function fixture() {
  const dir = fs.mkdtempSync(path.join(scratch, 'case-'));
  fs.cpSync(path.join(root,'app'), path.join(dir,'app'), {recursive:true, filter:p=>!p.includes('.buildResult')});
  fs.copyFileSync(path.join(root,'Install-TV.ps1'),path.join(dir,'Install-TV.ps1'));
  const sdk = path.join(dir,'sdk');
  const bin = path.join(sdk,'tools','ide','bin');
  fs.mkdirSync(bin,{recursive:true});
  fs.writeFileSync(path.join(bin,'tizen.bat'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mock.ps1" %*\r\nexit /b %ERRORLEVEL%\r\n');
  fs.writeFileSync(path.join(bin,'mock.ps1'), `
$ErrorActionPreference = 'Stop'
$Operation = $args[0]
$Target = $args[$args.Count - 1]
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'calls.txt') -Value $Operation
if ($Operation -eq 'build-web') {
  $Build = Join-Path $Target '.buildResult'
  New-Item -ItemType Directory -Path $Build -Force | Out-Null
  Get-ChildItem -LiteralPath $Target -File | Copy-Item -Destination $Build
} elseif ($Operation -eq 'package') {
  if (Test-Path (Join-Path $PSScriptRoot 'fail-package')) { exit 19 }
  'TEST SIGNATURE ONLY' | Set-Content (Join-Path $Target 'author-signature.xml')
  'TEST SIGNATURE ONLY' | Set-Content (Join-Path $Target 'signature1.xml')
  if (Test-Path (Join-Path $PSScriptRoot 'inject-secret')) { 'TEST KEY' | Set-Content (Join-Path $Target 'private.p12') }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $TempZip = Join-Path $PSScriptRoot 'package.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($Target, $TempZip)
  Move-Item -LiteralPath $TempZip -Destination (Join-Path $Target 'TizenOS Plex.wgt')
} else { throw 'Unexpected SDK action' }
`);
  const invoke = (profile='Fixture Profile') => spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'Install-TV.ps1'),'-TizenStudio',sdk,'-CertificateProfile',profile,'-BuildOnly'],{encoding:'utf8',windowsHide:true,timeout:30000});
  const calls = () => fs.existsSync(path.join(bin,'calls.txt')) ? fs.readFileSync(path.join(bin,'calls.txt'),'utf8') : '';
  return {dir, bin, invoke, calls, output:path.join(dir,'dist','TizenOSPlex.wgt')};
}
test('BuildOnly builds and packages without installing; replaces a stale build', {skip:process.platform!=='win32'},()=>{
  const f=fixture();
  fs.mkdirSync(path.join(f.dir,'app','.buildResult'));
  fs.writeFileSync(path.join(f.dir,'app','.buildResult','stale.wgt'),'stale');
  const result=f.invoke();
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.ok(fs.existsSync(f.output));
  const license=fs.readFileSync(path.join(root,'LICENSE'),'utf8');
  assert.equal(fs.readFileSync(path.join(root,'app','LICENSE'),'utf8'),license,'The packaged license must match the source license');
  assert.equal(fs.readFileSync(path.join(f.dir,'app','.buildResult','LICENSE'),'utf8'),license);
  assert.deepEqual(f.calls().trim().split(/\r?\n/),['build-web','package']);
});
test('private source content is rejected before invoking SDK', {skip:process.platform!=='win32'},()=>{
  const f=fixture(); fs.writeFileSync(path.join(f.dir,'app','author.p12'),'TEST KEY');
  const result=f.invoke(); assert.notEqual(result.status,0);
  assert.match(result.stderr,/Unexpected app content/); assert.equal(f.calls(),'');
  assert.equal(fs.existsSync(f.output),false);
});
test('private content in a package is never exported', {skip:process.platform!=='win32'},()=>{
  const f=fixture(); fs.writeFileSync(path.join(f.bin,'inject-secret'),'');
  const result=f.invoke(); assert.notEqual(result.status,0);
  assert.match(result.stderr,/Unexpected package entry/); assert.equal(fs.existsSync(f.output),false);
});
test('signing failure does not export a package', {skip:process.platform!=='win32'},()=>{
  const f=fixture(); fs.writeFileSync(path.join(f.bin,'fail-package'),'');
  const result=f.invoke(); assert.notEqual(result.status,0);
  assert.match(result.stderr,/Tizen command failed/); assert.equal(fs.existsSync(f.output),false);
});
test('shell metacharacters in a profile never reach the batch CLI', {skip:process.platform!=='win32'},()=>{
  const f=fixture(); const result=f.invoke('bad&profile'); assert.notEqual(result.status,0);
  assert.equal(f.calls(),''); assert.equal(fs.existsSync(f.output),false);
});
test('build directory junction is rejected without touching its target', {skip:process.platform!=='win32'},()=>{
  const f=fixture();
  const outside=fs.mkdtempSync(path.join(scratch,'protected-'));
  const marker=path.join(outside,'keep.txt');
  fs.writeFileSync(marker,'KEEP');
  fs.symlinkSync(outside,path.join(f.dir,'app','.buildResult'),'junction');
  const result=f.invoke(); assert.notEqual(result.status,0);
  assert.match(result.stderr,/symbolic link or junction/);
  assert.equal(fs.readFileSync(marker,'utf8'),'KEEP');
  assert.equal(f.calls(),'');
});
