(function (root) {
  'use strict';
  // All Samsung API use is behind this adapter so state transitions can be tested.
  function Player(av, events, clock) {
    this.av = av;
    this.events = events || {};
    // Browser timer methods require the Window receiver, not this adapter object.
    this.clock = clock || {
      setTimeout: function (fn, delay) { return setTimeout(fn, delay); },
      clearTimeout: function (id) { clearTimeout(id); },
      setInterval: function (fn, delay) { return setInterval(fn, delay); },
      clearInterval: function (id) { clearInterval(id); }
    };
    this.generation = 0;
    this.active = false;
    this.started = false;
    this.seeking = false;
    this.pendingStop = false;
    this.time = 0;
    this.duration = 0;
    this.subtitleTimer = null;
    this.subtitleRemaining = 0;
  }
  Player.prototype.emit = function (name) {
    if (this.events[name]) this.events[name].apply(null, Array.prototype.slice.call(arguments, 1));
  };
  Player.prototype.subtitleNow = function () { return this.clock.now ? this.clock.now() : Date.now(); };
  Player.prototype.pauseSubtitleClock = function () {
    if(this.subtitleTimer!==null)this.subtitleRemaining=Math.max(0,this.subtitleRemaining-(this.subtitleNow()-this.subtitleStartedAt));
    this.clock.clearTimeout(this.subtitleTimer);this.subtitleTimer=null;
  };
  Player.prototype.resumeSubtitleClock = function () {
    this.clock.clearTimeout(this.subtitleTimer);this.subtitleTimer=null;
    if(!this.active||this.state!=='playing'||this.subtitleOff||!this.subtitleRemaining)return;
    var self=this,epoch=this.generation;this.subtitleStartedAt=this.subtitleNow();
    var timer=this.clock.setTimeout(function(){
      if(!self.active||epoch!==self.generation||self.subtitleTimer!==timer)return;
      self.clock.clearTimeout(timer);self.subtitleTimer=null;self.subtitleRemaining=0;self.emit('subtitle','');
    },this.subtitleRemaining);this.subtitleTimer=timer;
  };
  Player.prototype.clearSubtitle = function () {
    this.clock.clearTimeout(this.subtitleTimer);this.subtitleTimer=null;this.subtitleRemaining=0;this.emit('subtitle','');
  };
  Player.prototype.watchBuffering = function () {
    this.clock.clearTimeout(this.bufferTimer);
    if(!this.buffering||!this.started||this.state!=='playing'||this.seeking)return;
    var self=this,epoch=this.generation;
    this.bufferTimer=this.clock.setTimeout(function(){if(self.active&&epoch===self.generation&&self.buffering&&self.state==='playing')self.fail(new Error('Playback buffering timed out. Check the server and connection, then retry.'));},30000);
  };
  Player.prototype.open = function (url, item, offset, options) {
    options=options||{};
    var self = this;
    if (this.active) throw new Error('Stop the current video before opening another.');
    if (!this.av) throw new Error('Samsung playback is available on the TV only.');
    var epoch = ++this.generation;
    function valid() { return self.active && self.generation === epoch; }
    function fail(e) { if (valid()) self.fail(e); }
    this.item = item;
    this.active = true;
    this.started = false;
    this.seeking = false;
    this.pendingStop = false;
    this.time = Number(offset || 0);
    this.selectedTracks = {};
    this.subtitleOff = false;
    this.buffering = false;
    this.duration = Number(item.duration || 0);
    this.state = 'buffering';
    this.emit('state', 'buffering');
    try {
      this.av.open(url);
      this.av.setDisplayRect(0, 0, 1920, 1080);
      this.av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      this.av.setListener({
        onbufferingstart: function () { if (valid()){self.buffering=true;self.watchBuffering();self.emit('buffer', true);} },
        onbufferingprogress: function (percent) { if (valid()) self.emit('buffer', true, percent); },
        onbufferingcomplete: function () { if (valid()){self.buffering=false;self.clock.clearTimeout(self.bufferTimer);self.emit('buffer', false);} },
        oncurrentplaytime: function (time) {
          if (!valid() || !self.started || self.seeking) return;
          if(time>self.time)self.watchBuffering();
          self.time = time;
          self.emit('progress', self.time, self.duration);
        },
        onstreamcompleted: function () {
          if (!valid()) return;
          self.time = self.duration;
          self.stop({completed:true});
        },
        onerror: fail,
        onsubtitlechange: function (ms, text, type) {
          if (!valid() || self.subtitleOff) return;
          if(String(type)==='1'){self.emit('notice','This subtitle is image-based; choose a text track for size and color controls.');return;}
          self.clock.clearTimeout(self.subtitleTimer);
          self.subtitleTimer=null;
          self.subtitleRemaining=Math.max(0,Math.min(Number(ms)||3000,15000));
          self.emit('subtitle', String(text || ''));
          self.resumeSubtitleClock();
        }
      });
      this.prepareTimer = this.clock.setTimeout(function () { fail(new Error('Playback preparation timed out. Try another file or check the server.')); }, options.timeout||20000);
      this.av.prepareAsync(function () {
        if (!valid()) return;
        self.clock.clearTimeout(self.prepareTimer);
        try {
          self.duration = self.av.getDuration() || self.duration;
          try { self.av.setSilentSubtitle(false); } catch (_) { /* Text callback support varies by firmware. */ }
          function start() {
            if (!valid()) return;
            try {
              self.av.play();
              self.started = true;
              self.state = 'playing';
              self.resumeSubtitleClock();
              self.watchBuffering();
              self.emit('state', 'playing');
              self.emit('buffer', false);
              self.emit('ready');
              self.report();
              self.reportTimer = self.clock.setInterval(function () { if (valid() && !self.seeking) self.report(); }, 10000);
            } catch (e) { fail(e); }
          }
          if (offset > 0) self.seek(offset, start);
          else start();
        } catch (e) { fail(e); }
      }, fail);
    } catch (e) { fail(e); }
  };
  Player.prototype.report = function (state) {
    // Never write a zero-position timeline for a failed prepare/resume operation.
    if (this.started) this.emit('report', this.item, state || this.state, this.time, this.duration);
  };
  Player.prototype.seek = function (target, done) {
    if (!this.active || this.seeking) return;
    var self = this, epoch = this.generation;
    target = Math.max(0, Math.min(Number(target) || 0, Math.max(0, this.duration - 1000)));
    this.seeking = true;
    this.clearSubtitle();
    this.emit('buffer', true);
    function finish(error) {
      if (!self.active || epoch !== self.generation) return;
      self.clock.clearTimeout(self.seekTimer);
      self.seeking = false;
      self.watchBuffering();
      self.emit('buffer', false);
      if (self.pendingStop) { var stopOptions=self.pendingStop;self.pendingStop=false;self.stop(stopOptions);return; }
      if (error) {
        if (!self.started) self.fail(new Error('Resume failed. Try Play from beginning.'));
        else self.emit('notice', 'This file could not seek to that position.');
        return;
      }
      self.time = target;
      self.emit('progress', target, self.duration);
      if (done) done();
      else self.report();
    }
    this.seekTimer=this.clock.setTimeout(function(){if(self.active&&epoch===self.generation){self.seeking=false;self.fail(new Error('Seeking timed out.'));}},15000);
    try { this.av.seekTo(target, function () { finish(); }, finish); }
    catch (e) { finish(e); }
  };
  Player.prototype.toggle = function () {
    if (!this.active || !this.started || this.seeking) return;
    try {
      if (this.state === 'paused') { this.av.play(); this.state = 'playing'; this.resumeSubtitleClock(); }
      else { this.av.pause(); this.state = 'paused'; this.pauseSubtitleClock(); }
      this.watchBuffering();
      this.emit('state', this.state);
      this.report();
    } catch (e) { this.fail(e); }
  };
  Player.prototype.tracks = function (type) {
    if (!this.started || this.seeking) return [];
    return this.av.getTotalTrackInfo().filter(function (track) { return track.type === type; });
  };
  Player.prototype.selectTrack = function (type, index) {
    if (!this.started || this.seeking) throw new Error('Wait for playback or seeking to finish, then choose a track.');
    if (type === 'AUDIO' && this.state !== 'playing') throw new Error('Resume playback before changing audio.');
    if (index >= 0) this.av.setSelectTrack(type, index);
    if (type === 'TEXT') {
      // Tizen 5 / AVPlay 4.1 suppresses callbacks when silent is true. Keep
      // selected tracks enabled; onsubtitlechange feeds our accessible renderer.
      this.av.setSilentSubtitle(index < 0);
      this.subtitleOff = index < 0;
    }
    this.selectedTracks[type] = index;
    this.clearSubtitle();
  };
  Player.prototype.currentTrack = function (type) {
    if (!this.started || this.seeking) return null;
    if (type === 'TEXT' && this.subtitleOff) return -1;
    try {
      var current = this.av.getCurrentStreamInfo().filter(function (track) { return track.type === type; })[0];
      return current ? current.index : (type === 'TEXT' ? -1 : null);
    } catch (_) {
      return this.selectedTracks[type] === undefined ? null : this.selectedTracks[type];
    }
  };
  Player.prototype.subtitleDelay = function (delay) {
    if(!this.started||this.seeking)throw new Error('Wait for playback before changing subtitle timing.');
    try { this.av.setSubtitlePosition(delay); }
    catch(_){throw new Error('This TV cannot retime this embedded track. Choose a text stream from Plex for adjustable timing.');}
  };
  Player.prototype.stop = function (options) {
    options=options||{};
    if (!this.active) return;
    if (this.seeking) { if(!this.pendingStop)this.pendingStop=options;this.emit('notice', 'Stopping when the current seek finishes…'); return; }
    if(options.report!==false)this.report('stopped');
    this.active = false;
    ++this.generation;
    this.clock.clearTimeout(this.prepareTimer);
    this.clearSubtitle();
    this.clock.clearTimeout(this.seekTimer);
    this.clock.clearTimeout(this.bufferTimer);
    this.clock.clearInterval(this.reportTimer);
    try { this.av.stop(); } catch (_) { /* Close still releases the session. */ }
    try { this.av.close(); } catch (_) { /* A failed open may have no session. */ }
    this.started = false;
    this.emit('state', 'stopped');
    if(options.notify!==false)this.emit('stopped',{completed:options.completed===true});
  };
  Player.prototype.fail = function (error) {
    // AVPlay has completed its error callback; there is no outstanding seek to wait for.
    this.seeking = false;
    var context={time:this.time,started:this.started};
    this.stop({notify:false,report:false});
    this.emit('error', error, context);
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Player;
  else root.TizenPlexPlayer = Player;
}(this));
