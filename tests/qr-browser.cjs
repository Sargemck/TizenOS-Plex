'use strict';
// Independent decoding of actual browser-rendered pixels, with no TV/network.
// Developer-only prerequisite: python -m pip install opencv-python-headless
// Run: node tests/qr-browser.cjs (set PLAYWRIGHT_CHANNEL=msedge if needed).
// Missing OpenCV is an explicit failure, never a silently skipped decode check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const python = process.env.PLEX_QR_PYTHON || 'python';
const decoder = [
  'import sys, cv2, numpy as np',
  'image = cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(), dtype=np.uint8), cv2.IMREAD_GRAYSCALE)',
  'assert image is not None, "Unable to read rendered QR image"',
  'print(cv2.QRCodeDetector().detectAndDecode(image)[0])'
].join('\n');

(async () => {
  const prerequisite = spawnSync(python, ['-c', 'import cv2, numpy'], {encoding:'utf8'});
  assert.equal(prerequisite.status, 0, 'QR decode verification requires Python/OpenCV. Run python -m pip install opencv-python-headless. ' +
    (prerequisite.error ? prerequisite.error.message : prerequisite.stderr));
  const browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || undefined});
  try {
    const page = await browser.newPage({viewport:{width:1920,height:1080}});
    const requests = [], errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body style="margin:0;background:#173329"></body></html>');
    await page.addScriptTag({content:fs.readFileSync(path.resolve(__dirname, '../app/qr.js'), 'utf8')});
    await page.evaluate(() => document.body.appendChild(TizenQR.render(TizenQR.url)));
    const qr = page.getByRole('img', {name:'Scan to open plex.tv/link on your phone'});
    fs.mkdirSync(path.resolve('test-results'), {recursive:true});
    for (const pixels of [220, 264, 330, 660]) {
      await qr.evaluate((node, size) => { node.style.width = size + 'px'; node.style.height = size + 'px'; }, pixels);
      const png = await qr.screenshot({path:path.resolve('test-results', 'pairing-qr-' + pixels + '.png')});
      const result = spawnSync(python, ['-c', decoder], {input:png, maxBuffer:1024 * 1024});
      assert.equal(result.status, 0, String(result.stderr));
      assert.equal(String(result.stdout).trim(), 'https://plex.tv/link', 'Independent decode at ' + pixels + 'px');
    }
    assert.deepEqual(requests, [], 'Rendering and resizing QR makes no network requests');
    assert.deepEqual(errors, []);
    console.log('QR browser: public destination decoded from rendered pixels at four sizes; zero network requests.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
