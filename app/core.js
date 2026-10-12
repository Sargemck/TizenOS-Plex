(function (root) {
  'use strict';
  function query(values) {
    return Object.keys(values).filter(function (k) { return values[k] !== undefined && values[k] !== null; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(values[k]); }).join('&');
  }
  function normalizeServer(value) {
    var url = new URL(String(value).trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error('Use only the server address, for example http://192.168.1.20:32400 (without /web).');
    }
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url.hostname)) {
      throw new Error('Use your PC’s network address. Localhost on the TV means the TV itself.');
    }
    return url.origin;
  }
  function mediaURL(server, path, token, extra) {
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || path.indexOf('\\') >= 0 || /[\x00-\x20\x7f]/.test(path)) {
      throw new Error('The server returned an invalid media path.');
    }
    var values = Object.assign({}, extra || {}, { 'X-Plex-Token': token });
    return server + path + (path.indexOf('?') < 0 ? '?' : '&') + query(values);
  }
  function safeError(error) {
    var value = String(error && (error.message || error.name) || error || 'Unknown error');
    return value.replace(/https?:\/\/[^\s]+/gi, '[address hidden]')
      .replace(/(X-Plex-Token|authenticationToken|accessToken|authToken|token|password|pin|code)([=:\s"']+)[^\s&"']+/gi, '$1$2[hidden]').slice(0, 260);
  }
  function duration(ms) {
    var sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    return (sec >= 3600 ? Math.floor(sec / 3600) + ':' : '') + (sec >= 3600 ? ('0' + Math.floor(sec / 60) % 60).slice(-2) : Math.floor(sec / 60)) + ':' + ('0' + sec % 60).slice(-2);
  }
  function extract(data) {
    var box = data.MediaContainer || data;
    return { items: box.Metadata || box.Directory || [], total: Number(box.totalSize === undefined ? box.size || 0 : box.totalSize) };
  }
  function primaryPart(item) {
    var medias = item.Media || [];
    if (!medias.length || !(medias[0].Part || []).length) throw new Error('No playable file was returned by Plex.');
    if (medias[0].Part.length !== 1) throw new Error('Multi-part files are not supported in this first build.');
    return { media: medias[0], part: medias[0].Part[0] };
  }
  function trackLabel(track, position) {
    var info = {};
    try { info = JSON.parse(track.extra_info || '{}') || {}; } catch (_) { /* Optional TV metadata. */ }
    var language = String(track.languageCode || info.language || info.track_lang || '').trim().toLowerCase();
    if(language==='un'||language==='und')language='';
    var names = { en: 'English', eng: 'English', tr: 'Turkish', tur: 'Turkish', fr: 'French', fra: 'French', fre: 'French', de: 'German', deu: 'German', ger: 'German', es: 'Spanish', spa: 'Spanish', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', zho: 'Chinese', chi: 'Chinese', ar: 'Arabic', ara: 'Arabic', ru: 'Russian', rus: 'Russian' };
    var parts = [(track.type === 'AUDIO' ? 'Audio ' : 'Subtitle ') + (position + 1), track.displayTitle || names[language] || language || 'Language unknown'];
    if (info.fourCC && String(info.fourCC).trim().toLowerCase()!==language && !/^(un|und)$/i.test(String(info.fourCC).trim())) parts.push(String(info.fourCC).trim());
    if (track.type === 'AUDIO' && Number(info.channels) > 0) parts.push(info.channels + ' channels');
    return parts.join(' · ');
  }
  function request(url, options) {
    options = options || {};
    var xhr;
    var promise = new Promise(function (resolve, reject) {
      xhr = new XMLHttpRequest();
      xhr.open(options.method || 'GET', url, true);
      xhr.timeout = options.timeout || 12000;
      xhr.setRequestHeader('Accept', options.format === 'text' ? 'text/plain, application/xml, */*' : 'application/json');
      if (options.format === 'text') xhr.overrideMimeType('text/plain; charset=utf-8');
      Object.keys(options.headers || {}).forEach(function (key) { xhr.setRequestHeader(key, options.headers[key]); });
      xhr.onprogress = function (event) {
        if(options.maxBytes&&event.loaded>options.maxBytes){reject(new Error('The response is too large for this TV.'));xhr.abort();return;}
        if(options.onTextProgress){try{options.onTextProgress(xhr.responseText);}catch(error){reject(error);xhr.abort();}}
      };
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          var error = new Error(xhr.status === 401 ? 'Plex rejected the sign-in. Sign out and link again.' : 'Plex request failed (HTTP ' + xhr.status + ').');
          error.status = xhr.status; reject(error); return;
        }
        if (options.noBody) { resolve({}); return; }
        if (options.format === 'text') { resolve(xhr.responseText); return; }
        try { resolve(JSON.parse(xhr.responseText)); } catch (_) { reject(new Error('Plex returned an unexpected response format.')); }
      };
      xhr.onerror = function () { reject(new Error('Cannot reach Plex. Check the PC is awake, the address is correct, and both devices are on the same network.')); };
      xhr.ontimeout = function () { reject(new Error('Plex did not respond in time. Check the PC and network, then retry.')); };
      xhr.onabort = function () { var error = new Error('Request cancelled.'); error.cancelled = true; reject(error); };
      xhr.send(options.body || null);
    });
    promise.abort = function () { if (xhr) xhr.abort(); };
    return promise;
  }
  var core = { query: query, normalizeServer: normalizeServer, mediaURL: mediaURL, safeError: safeError, duration: duration, extract: extract, primaryPart: primaryPart, trackLabel: trackLabel, request: request };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.TizenPlex = core;
}(this));
