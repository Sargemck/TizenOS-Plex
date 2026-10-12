'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../app/qr.js'), 'utf8');

function load() {
  const document = {createElementNS(namespace, name) {
    return {namespace, name, attributes: {}, children: [],
      setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { this.children.push(child); }};
  }};
  // No network, storage, encoder or timer globals are provided to this module.
  const window = {document};
  vm.runInNewContext(source, {window});
  return window.TizenQR;
}

test('pairing QR only accepts its fixed public destination, never a code or token', () => {
  const qr = load();
  assert.equal(qr.url, 'https://plex.tv/link');
  for (const invalid of [undefined, null, '', 'http://plex.tv/link', 'https://plex.tv/link/',
    'https://plex.tv/link?code=1234', 'https://plex.tv/link#token=secret', 'https://example.invalid/link',
    {toString() { return qr.url; }}]) {
    assert.throws(() => qr.render(invalid), /public Plex linking URL only/);
  }
});

test('pairing QR has high contrast and a full four-module quiet zone at every edge', () => {
  const qr = load(), svg = qr.render(qr.url);
  assert.equal(svg.name, 'svg');
  assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(svg.attributes.viewBox, '0 0 33 33');
  assert.equal(svg.attributes.role, 'img');
  assert.match(svg.attributes['aria-label'], /plex\.tv\/link/);
  assert.equal(svg.attributes.focusable, 'false');
  assert.equal(svg.children.length, 2);
  const [background, modules] = svg.children;
  assert.equal(background.attributes.fill, '#fff');
  assert.equal(background.attributes.width, '33');
  assert.equal(background.attributes.height, '33');
  assert.equal(modules.attributes.fill, '#000');
  const cells = [...modules.attributes.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)];
  assert.ok(cells.length > 250);
  for (const cell of cells) {
    assert.ok(+cell[1] >= 4 && +cell[1] <= 28);
    assert.ok(+cell[2] >= 4 && +cell[2] <= 28);
  }
  // Rendering returns independent DOM elements; a removed/altered dialog cannot
  // damage the next pairing attempt's symbol.
  modules.attributes.d = '';
  assert.ok(qr.render(qr.url).children[1].attributes.d.length > 0);
});
