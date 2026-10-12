/* Local, fixed-destination QR rendering. No pairing code or credential is encoded.
 * The version 2 / correction M symbol below represents https://plex.tv/link only.
 * It was generated offline with OpenCV's QRCodeEncoder, not copied library code:
 * params.version = 2; params.correction_level = QRCodeEncoder_CORRECT_LEVEL_M;
 * QRCodeEncoder_create(params).encode(URL), with its two-module border removed.
 * Keeping the fixed symbol avoids shipping a general-purpose encoder on the TV.
 * The renderer supplies the required four-module white quiet zone on every side.
 * QR dimensions: https://www.qrcode.com/en/howto/code.html
 */
(function (root) {
  'use strict';
  var URL = 'https://plex.tv/link';
  var NS = 'http://www.w3.org/2000/svg';
  var SYMBOL = [
    '1111111000111100101111111',
    '1000001001010001001000001',
    '1011101010110011101011101',
    '1011101011000110001011101',
    '1011101010100100101011101',
    '1000001011000111101000001',
    '1111111010101010101111111',
    '0000000010000000100000000',
    '1011111001001110001111100',
    '0001010000111100000100010',
    '1111011101010101010001011',
    '1001010000001010101000001',
    '0110001010110001111110111',
    '1001010000001100100101010',
    '1000001010100111011111011',
    '1001000111001101111110001',
    '1111101001101011111110100',
    '0000000010100000100011000',
    '1111111000111000101010111',
    '1000001011110010100011001',
    '1011101011110001111110111',
    '1011101011001111111011111',
    '1011101011000110110001101',
    '1000001001001101100111001',
    '1111111010101011001111111'
  ];

  function element(name, attributes) {
    var node = root.document.createElementNS(NS, name);
    Object.keys(attributes).forEach(function (key) { node.setAttribute(key, attributes[key]); });
    return node;
  }

  function render(url) {
    // Reject alternate destinations, query parameters and pairing secrets. The
    // readable URL and temporary code remain separate, accessible UI elements.
    if (url !== URL) throw new Error('QR pairing supports the public Plex linking URL only.');
    var svg = element('svg', {
      viewBox: '0 0 33 33', width: '330', height: '330',
      role: 'img', 'aria-label': 'Scan to open plex.tv/link on your phone',
      focusable: 'false', 'shape-rendering': 'crispEdges'
    });
    svg.appendChild(element('rect', {x: '0', y: '0', width: '33', height: '33', fill: '#fff'}));
    var path = [], y, x;
    for (y = 0; y < SYMBOL.length; y += 1) {
      for (x = 0; x < SYMBOL[y].length; x += 1) {
        if (SYMBOL[y].charAt(x) === '1') path.push('M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z');
      }
    }
    svg.appendChild(element('path', {d: path.join(''), fill: '#000'}));
    return svg;
  }

  root.TizenQR = {url: URL, render: render};
}(window));
