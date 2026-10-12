'use strict';

// Short-lived Samsung web service. Credentials exist only in the incoming
// request and HTTP headers; launcher JSON contains local artwork and opaque IDs.
var Preview = require('./preview.js');
var MIN_UPDATE_MS = 10 * 60 * 1000;
var MAX_IMAGE_BYTES = 384 * 1024;

function createService(env) {
  var generation = 0, active = [], deadline = null;
  var setTimer = env.setTimeout || setTimeout, clearTimer = env.clearTimeout || clearTimeout;
  function stopRequests() {
    active.forEach(function (request) { request.destroy(); });
    active = [];
    clearTimer(deadline);
  }
  function exit(stamp) {
    if (stamp !== generation) return;
    stopRequests();
    env.exit();
  }
  function clean(folder, keep) {
    env.fs.readdirSync(folder).forEach(function (name) {
      if (/^poster-[0-9]+-[0-9]+\.(jpg|png)$/.test(name) && keep.indexOf(name) < 0) {
        try { env.fs.unlinkSync(folder + '/' + name); } catch (_) { /* Next run retries cleanup. */ }
      }
    });
  }
  function normalize(payload) {
    if (!payload || payload.version !== 1) throw new Error('Invalid preview request');
    if (payload.clear === true) return {clear: true, sections: []};
    // Keep Node's legacy URL parser (available on the baseline TV service) behind
    // a strict origin grammar; reject parser-normalized credentials and paths.
    if (typeof payload.server !== 'string' || !/^https?:\/\/(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?$/.test(payload.server)) throw new Error('Invalid preview origin');
    var origin = env.url.parse(payload.server);
    if (!/^https?:$/.test(origin.protocol) || !origin.hostname || origin.auth ||
        origin.search || origin.hash || (origin.pathname && origin.pathname !== '/') ||
        /[\s\\]/.test(payload.server) || (origin.port && (Number(origin.port) < 1 || Number(origin.port) > 65535))) throw new Error('Invalid preview origin');
    if (typeof payload.token !== 'string' || !payload.token || payload.token.length > 2048 || /[\r\n]/.test(payload.token)) throw new Error('Invalid credential');
    if (!Array.isArray(payload.sections) || payload.sections.length > 3) throw new Error('Invalid preview rows');
    payload.sections.forEach(function (row) {
      if (typeof row.title !== 'string' || row.title.length > 120 || !Array.isArray(row.tiles) || row.tiles.length > 6) throw new Error('Invalid preview row');
      row.tiles.forEach(function (tile) {
        if (!tile || typeof tile.title !== 'string' || tile.title.length > 160 ||
            !/^[0-9]{1,20}$/.test(tile.id) || typeof tile.scope !== 'string' || tile.scope.length > 500 ||
            typeof tile.image !== 'string' || tile.image.length > 512 ||
            (tile.image && (!/^\/(?!\/)/.test(tile.image) || /[\\\r\n?#]/.test(tile.image)))) throw new Error('Invalid preview tile');
      });
    });
    return payload;
  }
  function image(payload, tile, folder, number, stamp) {
    return new Promise(function (resolve) {
      if (!tile.image || stamp !== generation) { resolve(null); return; }
      var address = env.url.parse(payload.server + '/photo/:/transcode?url=' + encodeURIComponent(tile.image) + '&width=167&height=250&minSize=1&upscale=0');
      address.headers = {'X-Plex-Token': payload.token};
      var client = address.protocol === 'https:' ? env.https : env.http;
      var done = false, timer, chunks = [], size = 0, request;
      function finish(value) { if (done) return; done = true; clearTimer(timer); resolve(value); }
      try {
        request = client.get(address, function (response) {
          // Never follow a redirect with a Plex credential.
          if (response.statusCode !== 200) { response.resume(); finish(null); return; }
          response.on('error', function () { finish(null); });
          response.on('data', function (chunk) {
            size += chunk.length;
            if (size > MAX_IMAGE_BYTES) { request.destroy(); finish(null); return; }
            chunks.push(chunk);
          });
          response.on('end', function () {
            if (done || stamp !== generation) { finish(null); return; }
            var data = Buffer.concat(chunks);
            var png = data.length > 8 && data.slice(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
            var jpg = data.length > 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
            if (!png && !jpg) { finish(null); return; }
            var name = 'poster-' + env.now() + '-' + number + (png ? '.png' : '.jpg');
            try { env.fs.writeFileSync(folder + '/' + name, data); finish(name); }
            catch (_) { finish(null); }
          });
        });
        active.push(request);
        request.on('error', function () { finish(null); });
        timer = setTimer(function () { request.destroy(); finish(null); }, 4000);
      } catch (_) { finish(null); }
    });
  }
  function run(raw, caller) {
    // An unrelated application cannot cancel an authorized update in progress.
    if (caller !== Preview.APP_ID) return Promise.resolve();
    generation++;
    var stamp = generation;
    stopRequests();
    if (typeof raw !== 'string' || raw.length > 64000) { exit(stamp); return Promise.resolve(); }
    var payload;
    try { payload = normalize(JSON.parse(raw)); } catch (_) { exit(stamp); return Promise.resolve(); }
    deadline = setTimer(function () { generation++; stopRequests(); env.exit(); }, 20000);
    return env.storage().then(function (storage) {
      if (stamp !== generation) return;
      var folder = storage.path + '/preview-cache', uri = storage.uri + '/preview-cache';
      if (!env.fs.existsSync(folder)) env.fs.mkdirSync(folder);
      var last = 0;
      try { last = Number(env.fs.readFileSync(folder + '/last-publish', 'utf8')) || 0; } catch (_) {}
      // Remove old artwork on sign-out/profile change even if Samsung throttles
      // the JSON update. Tiles also expire, and their deep links reject old scopes.
      if (payload.clear) clean(folder, []);
      if (env.now() - last < MIN_UPDATE_MS && env.now() >= last) { exit(stamp); return; }
      // Expired/unreferenced cache entries are bounded even after a failed run.
      clean(folder, []);
      var jobs = [];
      payload.sections.forEach(function (row, rowIndex) {
        row.tiles.forEach(function (tile) { jobs.push({tile: tile, row: rowIndex, number: jobs.length}); });
      });
      var output = payload.sections.map(function (row) { return {title: row.title, tiles: []}; });
      var keep = [], cursor = 0;
      function worker() {
        if (stamp !== generation || cursor >= jobs.length) return Promise.resolve();
        var job = jobs[cursor++];
        return image(payload, job.tile, folder, job.number, stamp).then(function (name) {
          if (stamp !== generation) return;
          if (name) {
            keep.push(name);
            output[job.row].tiles.push({title: job.tile.title, image_url: uri + '/' + name,
              image_ratio: '2by3', is_playable: false, position: job.number,
              display_until: Math.floor((env.now() + MIN_UPDATE_MS) / 1000),
              action_data: JSON.stringify({version: 1, scope: job.tile.scope, id: job.tile.id})});
          }
          return worker();
        });
      }
      return Promise.all([worker(), worker()]).then(function () {
        if (stamp !== generation) return;
        output = output.filter(function (row) { return row.tiles.length; });
        if (!output.length) output = [{title: 'TizenOS Plex', tiles: [{title: 'Open your library',
          image_url: storage.icon, image_ratio: '1by1', is_playable: false, action_data: '{}'}]}];
        return new Promise(function (resolve) {
          function finish(success) {
            if (stamp === generation) {
              try {
                if (success) { env.fs.writeFileSync(folder + '/last-publish', String(env.now())); clean(folder, keep); }
                else clean(folder, []);
              } catch (_) {}
              exit(stamp);
            }
            resolve();
          }
          try { env.publish(JSON.stringify({sections: output}), function () { finish(true); }, function () { finish(false); }); }
          catch (_) { finish(false); }
        });
      });
    }).catch(function () { exit(stamp); });
  }
  return {run: run, stop: stopRequests};
}

var service;
module.exports.createService = createService;
module.exports.onStart = function () {};
module.exports.onRequest = function () {
  var request = tizen.application.getCurrentApplication().getRequestedAppControl();
  var control = request && request.appControl;
  var data = control && control.operation === Preview.OPERATION && (control.data || []).filter(function (entry) { return entry.key === 'snapshot'; })[0];
  // Periodic platform launches have no private snapshot to refresh. Exit rather
  // than persist credentials or poll Plex while the foreground app is closed.
  if (!data || request.callerAppId !== Preview.APP_ID) {
    if (!service) tizen.application.getCurrentApplication().exit();
    return;
  }
  if (!service) service = createService({
    fs: require('fs'), url: require('url'), http: require('http'), https: require('https'), now: Date.now,
    exit: function () { tizen.application.getCurrentApplication().exit(); },
    publish: function (data, success, failure) { webapis.preview.setPreviewData(data, success, failure); },
    storage: function () {
      return new Promise(function (resolve, reject) {
        tizen.filesystem.resolve('wgt-private', function (directory) {
          var uri = directory.toURI().replace(/\/$/, '');
          tizen.filesystem.resolve('wgt-package/icon.png', function (icon) {
            resolve({path: decodeURIComponent(uri.replace(/^file:\/\//, '')), uri: uri, icon: icon.toURI()});
          }, reject, 'r');
        }, reject, 'rw');
      });
    }
  });
  service.run(data.value && data.value[0], request && request.callerAppId);
};
module.exports.onExit = function () { if (service) service.stop(); };
