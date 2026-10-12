(function (root) {
  'use strict';
  var APP_ID = 'TizenPlex1.TizenOSPlex';
  var SERVICE_ID = 'TizenPlex1.Preview';
  var OPERATION = 'http://tizen.org/appcontrol/operation/pick';

  function text(value, limit) { return typeof value === 'string' ? value.slice(0, limit) : ''; }
  function identifier(value) { return /^[0-9]{1,20}$/.test(String(value)) ? String(value) : ''; }

  // Treat app-control data as untrusted. A tile selects metadata, never a URL,
  // server, account or playback command. Revalidate against the current profile.
  function deepLink(request, scope) {
    try {
      var control = request && request.appControl;
      if (!control || control.operation !== 'http://samsung.com/appcontrol/operation/eden_resume') return null;
      var entry = (control.data || []).filter(function (item) { return item.key === 'PAYLOAD'; })[0];
      if (!entry || !entry.value || typeof entry.value[0] !== 'string' || entry.value[0].length > 2048) return null;
      var data = JSON.parse(entry.value[0]);
      if (typeof data.values === 'string') data = JSON.parse(data.values);
      return data && data.version === 1 && data.scope === scope && identifier(data.id) ? identifier(data.id) : null;
    } catch (_) { return null; }
  }

  function snapshot(rows, scope, features, preferences) {
    return rows.filter(function (row) { return row.items && row.items.length; }).slice(0, 3).map(function (row) {
      return {title: text(row.title, 120), tiles: row.items.slice(0, 6).filter(function (item) {
        return identifier(item.ratingKey);
      }).map(function (item) {
        var hidden = features.hideSpoiler(item, preferences);
        var path = hidden ? item.grandparentThumb : item.thumb || item.parentThumb || item.grandparentThumb;
        return {
          title: text(hidden ? (item.grandparentTitle || 'Episode') + ' · ' + features.episodeLabel(item) : item.title, 160),
          id: identifier(item.ratingKey), scope: text(scope, 500),
          // Only Plex-relative paths; the service supplies the verified origin.
          image: typeof path === 'string' && /^\/(?!\/)/.test(path) && !/[\\\r\n?#]/.test(path) ? path.slice(0, 512) : ''
        };
      })};
    }).filter(function (row) { return row.tiles.length; });
  }

  function Bridge(platform, report) {
    this.platform = platform;
    this.report = report;
    this.timer = null;
  }
  Bridge.prototype.available = function () {
    try { return !!this.platform.systeminfo.getCapability('http://tizen.org/feature/web.service'); }
    catch (_) { return false; }
  };
  Bridge.prototype.send = function (payload) {
    var self = this;
    if (!this.available()) { this.report('TV home preview is unavailable on this device.'); return; }
    try {
      var api = this.platform;
      var control = new api.ApplicationControl(OPERATION, null, null, null,
        [new api.ApplicationControlData('snapshot', [JSON.stringify(payload)])]);
      api.application.launchAppControl(control, SERVICE_ID, function () {}, function () {
        self.report('TV home preview could not be updated. Browsing and playback are unaffected.');
      });
    } catch (_) { this.report('TV home preview could not be updated.'); }
  };
  Bridge.prototype.update = function (payload) {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.send(payload); }, 800);
  };
  Bridge.prototype.clear = function () {
    clearTimeout(this.timer);
    this.send({version: 1, clear: true});
  };
  Bridge.prototype.cancel = function () { clearTimeout(this.timer); };
  var exported = {APP_ID: APP_ID, SERVICE_ID: SERVICE_ID, OPERATION: OPERATION,
    deepLink: deepLink, snapshot: snapshot, Bridge: Bridge};
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.TizenPreview = exported;
}(this));
