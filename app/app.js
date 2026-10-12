(function () {
  'use strict';
  var APP_VERSION = '0.4.3';
  var C = window.TizenPlex;
  var F = window.TizenFeatures, S = window.TizenSubtitles;
  var main = document.getElementById('main');
  var nav = document.getElementById('navigation');
  var shell = document.getElementById('shell');
  var playerUI = document.getElementById('player-ui');
  var controls = document.getElementById('player-controls');
  var playbackMenu = document.getElementById('playback-menu');
  var menuOptions = document.getElementById('playback-menu-options'), menuReturnFocus;
  var log = [], cache = [], stack = [], route = null, revision = 0, sections = [], accountEpoch = 0;
  var pinTimer, controlsTimer, toastTimer, playerReturn, lastBack = 0;
  var viewRequest, subtitleTimer, subtitleRequest, subtitleEpoch=0, subtitleCues=[], externalSubtitle=null, subtitleAnchor=0;
  var playbackAttempt=null, playbackEpoch=0, playbackRequest, applyingPreferences=false, scrub=null, previewTimer;
  var measurements=[], startedAt=performance.now(), firstLibrary=true;
  var libraryView=null, libraryFrame=null, homeView=null;
  var previewBridge = new window.TizenPreview.Bridge(window.tizen, note);
  var pendingPreviewId = null, connectionReady = false;
  var basePrefs,menuEpoch=0,nextRequest=null,pendingNextItem=null;
  var screenRenderer = null, restoreScreen = null, returningScreen = false;
  var menuParents=[],menuCurrent=null,descriptionText=null,descriptionScroll=0,loadingTarget=null;
  var focusedItem=document.getElementById('focused-item');
  var progressWrites=Object.create(null);
  var watchWrites=Object.create(null);
  var contextTracks={audio:'Not reported',subtitles:'Not reported'};
  var contextReadAt=0;
  function pressFeedback(node){
    if(!node||node.disabled)return;
    node.classList.add('pressed');clearTimeout(node.pressTimer);
    node.pressTimer=setTimeout(function(){node.classList.remove('pressed');},160);
  }
  document.addEventListener('click',function(event){var node=event.target.closest('button');if(node)pressFeedback(node);},true);
  function updatePlaybackContext(readTracks){
    var output=document.getElementById('playback-context');
    if(!output||!player||!playbackAttempt){if(output)output.textContent='';return;}
    if(readTracks&&player.started&&!player.seeking&&performance.now()-contextReadAt>250){
      contextReadAt=performance.now();
      function label(type){
        var index=player.currentTrack(type),tracks=availableTracks(type),track=tracks.filter(function(t){return t.index===index;})[0];
        return track?C.trackLabel(track,tracks.indexOf(track)).split(' · ').slice(1).join(' · '):'Not reported';
      }
      function streamLabel(stream){
        var language=F.trackLanguage(stream),name=language&&F.languages.filter(function(entry){return entry[0]===language;})[0];
        return stream.displayTitle||stream.language||(name&&name[1])||'Language unreported';
      }
      try{
        contextTracks.audio=label('AUDIO');
        contextTracks.subtitles=externalSubtitle?streamLabel(externalSubtitle):
          playbackAttempt.burn&&playbackAttempt.subtitleStream?streamLabel(playbackAttempt.subtitleStream)+' (in video)':
          player.subtitleOff?'Off':label('TEXT');
      }catch(_){contextTracks={audio:'Not reported',subtitles:'Not reported'};}
    }
    var duration=Number(player.started?player.duration:playbackAttempt.item.duration),time=Number(player.started?player.time:playbackAttempt.offset)||0;
    var remaining=duration>0?Math.ceil(Math.max(0,duration-time)/60000)+' min remaining':'Duration unavailable';
    var text=remaining+' · Audio: '+contextTracks.audio+' · Subtitles: '+contextTracks.subtitles;
    if(output.textContent!==text){
      output.textContent=text;
      if(!playerUI.hidden&&!controls.hidden)playerUI.style.setProperty('--controls-height',(controls.offsetHeight+20)+'px');
    }
  }
  // CSS, virtual rows and remote movement share these logical measurements.
  var layout = {width:1920, height:1080, columns:9, gap:18, scale:1};
  function fitInterface() {
    layout.scale = Math.min(window.innerWidth / layout.width, window.innerHeight / layout.height);
    var root = document.getElementById('ui-root');
    root.style.transform = 'scale(' + layout.scale + ')';
    root.style.left = Math.max(0, (window.innerWidth - layout.width * layout.scale) / 2) + 'px';
    root.style.top = Math.max(0, (window.innerHeight - layout.height * layout.scale) / 2) + 'px';
  }
  function gridMetrics(landscape) {
    var width = (main.clientWidth - 16 - layout.gap * (layout.columns - 1)) / layout.columns;
    // Progress lives over the artwork; reserve only title/context space below.
    // Nine portrait columns leave two full rows visible on the logical TV canvas.
    var height = Math.ceil(width * (landscape ? 0.5625 : 1.5)) + (prefs && prefs.largeUI ? 74 : 68);
    main.style.setProperty('--columns', layout.columns);
    main.style.setProperty('--card-height', height + 'px');
    main.style.setProperty('--grid-gap', layout.gap + 'px');
    return {columns:layout.columns, stride:height + layout.gap};
  }
  function focusIdentity() {
    var node = document.activeElement;
    return {id:node.id, text:node.textContent, nav:nav.contains(node)};
  }
  function restoreScreenFocus() {
    if (!restoreScreen) return;
    var saved = restoreScreen, root = saved.focus.nav ? nav : main;
    var node = saved.focus.id ? document.getElementById(saved.focus.id) : null;
    if (!node) node = Array.prototype.filter.call(root.querySelectorAll('button,input,select'), function (candidate) { return candidate.textContent === saved.focus.text; })[0];
    if (!node) return;
    restoreScreen = null;
    node.focus(); main.scrollTop = saved.scrollTop;
  }
  function visit(render) {
    var active = document.activeElement;
    stack.push({screen:screenRenderer, route:route, focus:focusIdentity(), scrollTop:main.scrollTop,
      index:active.hasAttribute('data-library-index') ? Number(active.getAttribute('data-library-index')) : active.getAttribute('data-home-focus')});
    render();
    screenRenderer = render;
  }
  function measure(name,start) { measurements.push({name:name,ms:Math.round(performance.now()-start)});if(measurements.length>60)measurements.shift(); }
  function get(key) { try { return localStorage.getItem('tizenosplex.' + key) || ''; } catch (_) { return ''; } }
  function put(key, value) { try { localStorage.setItem('tizenosplex.' + key, value);return true; } catch (_) { toast('TV storage is unavailable. Settings may not survive a restart.');return false; } }
  function remove(key) { try { localStorage.removeItem('tizenosplex.' + key); } catch (_) { /* Nothing persisted. */ } }
  var server = get('server'), token = get('token'), clientId = get('client');
  var accountToken=get('accountToken')||token,serverToken=token,serverId=get('serverId'),activeProfile=null;
  if(get('session')) {
    try {
      var savedSession=JSON.parse(get('session'));
      if(!savedSession.userToken||!savedSession.serverToken)throw new Error('Incomplete session');
      server=C.normalizeServer(savedSession.server);token=savedSession.userToken;serverToken=savedSession.serverToken;
      serverId=savedSession.machineId||get('serverId')||'';activeProfile=savedSession.profile||null;
    } catch(_){ token='';serverToken=''; /* Never fall back to owner access after a damaged Home session. */ }
  }
  var prefs;
  function loadPreferences(){var data={};try{data=JSON.parse(get('preferences.'+(activeProfile?activeProfile.id:'owner'))||'{}');}catch(_){}basePrefs=F.settings(data);prefs=F.settings(basePrefs);applySubtitleStyle();}
  function showPreferenceKey(item){var id=item&&(item.type==='show'?item.ratingKey:item.type==='episode'?item.grandparentRatingKey:null);return id?'showPreferences.'+encodeURIComponent(serverId||server)+'.'+(activeProfile?activeProfile.id:'owner')+'.'+encodeURIComponent(id):'';}
  function showPreference(item){var key=showPreferenceKey(item);try{return key&&get(key)?F.showPreferences(JSON.parse(get(key))):null;}catch(_){return null;}}
  function savePreferences(){var saved=F.settings(prefs);if(playbackAttempt&&showPreferenceKey(playerReturn)){saved.audioLanguage=basePrefs.audioLanguage;saved.subtitleLanguage=basePrefs.subtitleLanguage;saved.subtitleMode=basePrefs.subtitleMode;}basePrefs=saved;put('preferences.'+(activeProfile?activeProfile.id:'owner'),JSON.stringify(saved));applySubtitleStyle();}
  function saveTrackPreferences(type,track){if(track)prefs[type==='AUDIO'?'audioTraits':'subtitleTraits']=F.trackTraits(track);var key=showPreferenceKey(playerReturn);if(key){if(put(key,JSON.stringify(F.showPreferences(prefs))))toast('Audio and subtitles saved for this show. Reset them from either track menu.');applySubtitleStyle();}else savePreferences();}
  function preferenceScope(){return encodeURIComponent(serverId||server)+'.'+(activeProfile?activeProfile.id:'owner');}
  function libraryPreferenceKey(section){return 'libraryPreferences.'+preferenceScope()+'.'+encodeURIComponent(section.key);}
  function recentSearchKey(){return 'recentSearches.'+preferenceScope();}
  function readRecentSearches(){try{return F.recentSearches(JSON.parse(get(recentSearchKey())||'[]'));}catch(_){return [];}}
  function libraryPreferences(section){try{return F.libraryFilters(JSON.parse(get(libraryPreferenceKey(section))||'{}'));}catch(_){return F.libraryFilters();}}
  function clearLibraryPreferences(section){remove(libraryPreferenceKey(section));stack=[];browse(libraryRoute(section,{}));}
  function recoveryPoints(){try{var points=JSON.parse(get('recoveryPositions.'+preferenceScope())||'[]');return Array.isArray(points)?points.filter(function(p){return p&&typeof p.id==='string'&&isFinite(p.time)&&p.time>=0&&isFinite(p.updated);}).slice(-20):[];}catch(_){return [];}}
  function saveRecoveryPosition(item,time){var points=recoveryPoints().filter(function(p){return p.id!==String(item.ratingKey);});points.push({id:String(item.ratingKey),time:Math.max(0,Math.min(Number(time)||0,Number(item.duration)>0?Number(item.duration)-1000:Infinity)),updated:Date.now()});put('recoveryPositions.'+preferenceScope(),JSON.stringify(points.slice(-20)));}
  function clearRecoveryPosition(item,reportedAt){var points=recoveryPoints(),remaining=points.filter(function(p){return p.id!==String(item.ratingKey)||p.updated>=reportedAt;});if(remaining.length!==points.length)put('recoveryPositions.'+preferenceScope(),JSON.stringify(remaining));}
  if (!clientId) {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    clientId = 'tizenosplex-' + Array.prototype.map.call(bytes, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    put('client', clientId);
  }
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function btn(text, action, className) {
    var node = el('button', text, className);
    node.type = 'button';
    node.onclick = function(event){if(node.disabled)return;action.call(node,event);};
    return node;
  }
  function focusFirst(root) { var node = (root || main).querySelector('button:not(:disabled),input,select'); if (node) node.focus(); if (!root || root === main) restoreScreenFocus(); }
  function toast(message) {
    var node = document.getElementById('toast');
    node.textContent = message; node.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { node.hidden = true; }, 6000);
  }
  function note(message) {
    var clean = C.safeError(message);
    [token,serverToken,accountToken].forEach(function(secret){if(secret)clean=clean.split(secret).join('[hidden]');});
    log.push(new Date().toTimeString().slice(0, 8) + '  ' + clean);
    if (log.length > 40) log.shift();
  }
  function headers(auth) {
    var out = { 'X-Plex-Product': 'TizenOS Plex', 'X-Plex-Version': APP_VERSION, 'X-Plex-Client-Identifier': clientId, 'X-Plex-Platform': 'Tizen', 'X-Plex-Device': 'Samsung TV', 'X-Plex-Device-Name': 'TizenOS Plex' };
    if (auth) out['X-Plex-Token'] = serverToken;
    return out;
  }
  var service=new window.TizenService(C,function(){return headers(false);});
  function api(path, options) {
    // Reject absolute paths supplied by server metadata before attaching credentials.
    C.mediaURL(server, path, '');
    options = options || {};
    options.headers = Object.assign(headers(true),options.headers||{});
    var start = Date.now();
    var request=C.request(server + path, options);
    var result=request.then(function (data) {
      note('Server request OK · ' + (Date.now() - start) + ' ms'); return data;
    }, function (error) { note(error); throw error; });
    result.abort=request.abort;return result;
  }
  function thumb(item, width, height) {
    var path = item.thumb || item.parentThumb || item.grandparentThumb;
    if (!path) return '';
    try {
      C.mediaURL(server, path, '');
      return C.mediaURL(server, '/photo/:/transcode', serverToken, { url: path, width: width, height: height, minSize: 1, upscale: 0 });
    } catch (_) { return ''; }
  }
  function begin() {
    loadingTarget=null;main.setAttribute('aria-busy','false');
    document.getElementById('navigation-hint').textContent='← ↑ ↓ → Navigate · OK Select · Back Return';
    focusedItem.hidden=true;document.getElementById('focused-title').textContent='';document.getElementById('focused-meta').textContent='';
    if(!returningScreen)restoreScreen=null;
    screenRenderer = null;
    revision++;
    previewBridge.cancel();
    if (homeView) homeView.dispose();
    homeView = null;
    if(libraryView)Object.keys(libraryView.requests).forEach(function(key){libraryView.requests[key].abort();});
    libraryView=null;cancelAnimationFrame(libraryFrame);main.onscroll=null;main.classList.remove('library-view');main.scrollTop=0;
    if(viewRequest&&viewRequest.abort)viewRequest.abort();viewRequest=null;
    clearTimeout(pinTimer);
    main.textContent = '';
    return revision;
  }
  function errorPanel(error, retry) {
    loadingTarget=null;main.setAttribute('aria-busy','false');
    note(error);
    main.textContent = '';
    var panel = el('section', undefined, 'panel');
    panel.appendChild(el('div', 'Let’s get this working', 'eyebrow'));
    panel.appendChild(el('h1', 'Something interrupted Plex'));
    panel.appendChild(el('p', C.safeError(error)));
    if (retry) panel.appendChild(btn('Retry', retry, 'primary'));
    panel.appendChild(btn('Connection settings', setup));
    panel.appendChild(btn('Diagnostics', diagnostics));
    main.appendChild(panel); focusFirst();
  }
  function navigation(active) {
    if(active==='home')document.getElementById('navigation-hint').textContent='↑ ↓ Rows · ← → Titles · Right at row end: View all · OK Select · Back Return';
    nav.textContent = '';
    nav.appendChild(btn('Home', function () { stack = []; browse(homeRoute()); }, active === 'home' ? 'active' : ''));
    sections.forEach(function (section) {
      nav.appendChild(btn(section.title, function () { stack = []; browse(libraryRoute(section)); }, active === section.key ? 'active' : ''));
    });
    nav.appendChild(btn('My List', function () { stack = []; browse(savedRoute()); }, active === 'saved' ? 'active' : ''));
    nav.appendChild(btn('Search / Filter', function(){visit(searchScreen);}));
    nav.appendChild(btn(activeProfile?activeProfile.title:'Profiles', function(){visit(profiles);}));
    nav.appendChild(btn('Settings', function(){visit(setup);}));
  }
  function setup() {
    if (!token) { connectionSetup(false); return; }
    begin(); route = null; screenRenderer = setup;
    if(connectionReady)navigation('settings');
    main.appendChild(el('h1', 'Settings'));
    var panel = el('section', undefined, 'settings-menu'); main.appendChild(panel);
    [['Playback & languages',playbackSettings],['Subtitles & accessibility',subtitleSettings],['TV home preview',previewSettings],
      ['Connection settings',function(){connectionSetup(false);}],['Plex Home profiles',profiles],['Diagnostics',diagnostics]].forEach(function(entry){
      panel.appendChild(btn(entry[0],function(){visit(entry[1]);}));
    });
    panel.appendChild(btn('Refresh',function(){
      cache=[];
      // Leave Settings and refresh the library from which it was opened.
      if(stack.length && stack[stack.length-1].route) {stack[stack.length-1].focus=null;back();} else {stack=[];connect();}
    }));
    panel.appendChild(btn('Back',back)); focusFirst();
  }
  function connectionSetup(manual) {
    begin(); route = null; nav.textContent = '';
    screenRenderer = function(){connectionSetup(manual);};
    var panel = el('section', undefined, 'panel');
    panel.appendChild(el('div', 'Your server. Your screen.', 'eyebrow'));
    panel.appendChild(el('h1', 'Connect your Plex library'));
    panel.appendChild(el('p', 'Link Plex to find your server automatically, or enter its local address. Keep Plex Media Server running while you watch.'));
    panel.appendChild(btn(token?'Find my server':'Link Plex and find server',function(){if(token)discover(token,activeProfile);else visit(pair);},'primary'));
    if (!manual) {
      panel.appendChild(btn('Enter server address manually',function(){visit(function(){connectionSetup(true);});}));
      if (token) panel.appendChild(btn('Sign out on this TV',signOut));
      if (stack.length) panel.appendChild(btn('Back',back));
      main.appendChild(panel);focusFirst();return;
    }
    var label = el('label', 'Plex server address'); label.htmlFor = 'server-address';
    var input = el('input'); input.id = 'server-address'; input.type = 'url'; input.placeholder = 'http://192.168.1.20:32400'; input.value = server;
    input.autocomplete = 'off'; input.spellcheck = false;
    panel.appendChild(label); panel.appendChild(input);
    panel.appendChild(btn(token ? 'Connect' : 'Save and link Plex', function () {
      try { var manualServer=C.normalizeServer(input.value);if(manualServer!==server){disablePreview();serverId='';remove('serverId');}server=manualServer; } catch (e) { toast(e.message); input.focus(); return; }
      put('server', server); cache = []; stack = [];
      if (token) connect(); else visit(pair);
    }, 'primary'));
    if (token) panel.appendChild(btn('Sign out on this TV',signOut));
    panel.appendChild(btn('Back',back));
    panel.appendChild(el('p', 'Find the PC’s IPv4 address with ipconfig on Windows. Use its Wi-Fi or Ethernet address, not localhost.'));
    panel.appendChild(el('p', 'Local HTTP is unencrypted on your home network. A working HTTPS Plex server address is also accepted. This app does not change your server’s security settings.'));
    main.appendChild(panel); input.focus();restoreScreenFocus();
  }
  function signOut() {
    openPlaybackMenu('Sign out and clear local data?',
      'Remove sign-in details, My List, recent searches, browsing positions and preferences for all accounts, profiles and servers saved on this TV. Your Plex server media and watch progress stay unchanged.',[
        {label:'Keep signed in',selected:true,action:function(){}},
        {label:'Sign out and clear local data',keepOpen:true,action:function(){
          // Invalidate old-account callbacks before clearing their storage. A new
          // account must never inherit the previous account's "owner" namespace.
          accountEpoch++;
          try{
            var keys=[];
            for(var i=0;i<localStorage.length;i++){
              var key=localStorage.key(i);
              if(key&&key.indexOf('tizenosplex.')===0&&key!=='tizenosplex.client')keys.push(key);
            }
            // Clear launcher artwork while its opt-in state is still readable.
            disablePreview();
            var credentials=['tizenosplex.token','tizenosplex.accountToken','tizenosplex.session'];
            function clearKeys(list){
              list.forEach(function(key){localStorage.removeItem(key);});
              if(list.some(function(key){return localStorage.getItem(key)!==null;}))throw new Error('Local data remains');
            }
            // If storage fails mid-clear, retain credentials until every personal
            // record is gone; a restart cannot offer linking over uncleared data.
            clearKeys(keys.filter(function(key){return credentials.indexOf(key)<0;}));
            clearKeys(keys.filter(function(key){return credentials.indexOf(key)>=0;}));
          }catch(_){
            toast('Could not clear this TV\'s local data. You are still signed in. Retry sign-out before linking another account.');
            return;
          }
          closePlaybackMenu(false);connectionReady=false;
          token='';serverToken='';accountToken='';server='';serverId='';activeProfile=null;
          cache=[];sections=[];stack=[];log=[];measurements=[];loadPreferences();
          document.getElementById('connection').textContent='Unofficial Plex client';
          setup();toast('Signed out. Local lists, searches and preferences cleared on this TV.');
        }}
      ]);
  }
  function pair() {
    var stamp = begin(); nav.textContent = '';
    var panel = el('section', undefined, 'panel');
    panel.appendChild(el('div', 'Sign in with Plex', 'eyebrow'));
    panel.appendChild(el('h1', 'Link this TV'));
    panel.appendChild(el('p', 'Scan the QR code with your phone, or visit plex.tv/link on a phone or PC. Enter the code below.'));
    var pairing=el('div',undefined,'pairing-layout'),codeArea=el('div'),code = el('strong', '…', 'code');
    codeArea.appendChild(el('p','plex.tv/link'));codeArea.appendChild(code);pairing.appendChild(codeArea);
    pairing.appendChild(window.TizenQR.render(window.TizenQR.url));panel.appendChild(pairing);
    panel.appendChild(el('p', 'Your password stays with Plex. The sign-in token is saved on this TV until you sign out.'));
    panel.appendChild(btn('Cancel', back)); main.appendChild(panel); focusFirst();
    C.request('https://plex.tv/api/v2/pins?strong=false', { method: 'POST', headers: headers(false) }).then(function (pin) {
      if (stamp !== revision) return;
      if (!pin.id || !pin.code) throw new Error('Plex did not return a link code.');
      code.textContent = pin.code;
      var expires = Date.now() + Math.min(Number(pin.expiresIn || 300), 600) * 1000;
      function poll() {
        if (stamp !== revision) return;
        if (Date.now() >= expires) { errorPanel(new Error('This sign-in link has expired. Request a new one.'), pair); return; }
        C.request('https://plex.tv/api/v2/pins/' + encodeURIComponent(pin.id) + '?' + C.query({ code: pin.code }), { headers: headers(false) }).then(function (result) {
          if (stamp !== revision) return;
          if (result.authToken) { token = result.authToken;accountToken=token;serverToken=token;activeProfile=null;remove('session');put('token', token);put('accountToken',token);loadPreferences();note('Plex account linked'); connect(); }
          else pinTimer = setTimeout(poll, 2000);
        }, function (e) { if (stamp === revision) errorPanel(e, pair); });
      }
      pinTimer = setTimeout(poll, 2000);
    }).catch(function (e) { if (stamp === revision) errorPanel(e, pair); });
  }
  function homeRoute() { return { title: 'Home', kind: 'home', section: 'home' }; }
  function disablePreview() {
    if (get('tvPreview') === 'on') previewBridge.clear();
    remove('tvPreview'); remove('previewScope'); pendingPreviewId = null;
  }
  function previewSettings() {
    begin(); route = null;
    main.appendChild(el('h1', 'TV home preview'));
    main.appendChild(el('p', 'Show Continue watching and recently added titles above this app in Samsung Home. Tiles open details; they never start playback automatically.', 'help-copy'));
    main.appendChild(el('p', 'Anyone using the TV can see these titles and posters. Cached tiles may take up to ten minutes to expire after turning this off or switching profiles. This experimental feature still needs a device check.', 'help-copy'));
    var available = previewBridge.available();
    if (!available) main.appendChild(el('p', 'This device does not report support for TV home previews.', 'help-copy'));
    var panel = el('div', undefined, 'settings-panel'); main.appendChild(panel);
    selectField(panel, 'Show library on TV home', [['off','Off'],['on','On — visible to everyone using this TV']], get('tvPreview') || 'off', function (value) {
      if (value !== 'on') { disablePreview(); toast('TV home preview disabled. Cached tiles will expire.'); return; }
      if (!available) { toast('TV home preview is unavailable on this device.'); previewSettings(); return; }
      var bytes = new Uint8Array(16); window.crypto.getRandomValues(bytes);
      var scope = Array.prototype.map.call(bytes, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
      if (!put('previewScope', scope) || !put('tvPreview','on')) { disablePreview(); return; }
      browse(homeRoute()); toast('TV home preview enabled. Updates may take up to ten minutes.');
    });
    main.appendChild(btn('Back to settings', back)); focusFirst();
  }
  function updatePreview(rows) {
    if (get('tvPreview') !== 'on' || !get('previewScope')) return;
    previewBridge.update({version: 1, server: server, token: serverToken,
      sections: window.TizenPreview.snapshot(rows, get('previewScope'), F, prefs)});
  }
  function previewControl() {
    if (!token || get('tvPreview') !== 'on' || !get('previewScope')) return;
    var request;
    try { request = tizen.application.getCurrentApplication().getRequestedAppControl(); } catch (_) { return; }
    var id = window.TizenPreview.deepLink(request, get('previewScope'));
    if (!id) return;
    if (player.active || playbackAttempt) { toast('Stop playback before opening another title.'); return; }
    if (!connectionReady) { pendingPreviewId = id; return; }
    stack = [{route: homeRoute(), index: null, scrollTop: 0}]; detail(id);
  }
  function showHome(restoreKey, prefetch, restoreScroll) {
    begin(); focusedItem.hidden=false;gridMetrics(); route = homeRoute(); navigation('home');
    function remember(key) { stack.push({route: homeRoute(), index: key, scrollTop: main.scrollTop}); }
    homeView = new window.TizenHome({
      host: main, request: api, extract: C.extract, card: mediaCard, restore: restoreKey, columns:layout.columns,
      open: function (item, key) {
        remember(key);
        if (item.type === 'season') openSeason(item,item.parentRatingKey,'home');
        else detail(item.ratingKey);
      },
      browse: function (target, key) { remember(key); browse(target); },
      updated: updatePreview,
      leave:function(){var target=nav.querySelector('button.active')||nav.querySelector('button');if(target)target.focus();},
      ready: function () {
        if (firstLibrary) { measure('startup to library', startedAt); firstLibrary = false; }
        restoreScreenFocus();
      }
    });
    homeView.mount(sections, prefetch);
    main.scrollTop = restoreScroll || 0;
  }
  function connect() {
    connectionReady = false;
    var stamp = begin(); nav.textContent = '';
    main.appendChild(el('h1', 'Connecting to your library…'));
    if(!token){setup();return;}if(!server){discover(token,activeProfile);return;}
    var homeRequest=api('/hubs/continueWatching/items?'+C.query({'X-Plex-Container-Start':0,'X-Plex-Container-Size':12}),{timeout:5000});
    var preparedHome=homeRequest.then(function(data){return {data:data};},function(error){return {error:error};});
    viewRequest=api('/library/sections',{timeout:3000});viewRequest.then(function (data) {
      if (stamp !== revision) return;
      put('session',JSON.stringify({server:server,serverToken:serverToken,userToken:token,machineId:serverId,profile:activeProfile}));
      var prefetch=preparedHome.then(function(result){if(result.error)throw result.error;return result.data;});prefetch.abort=homeRequest.abort;
      connected(data,prefetch);
      if(!serverId) {
        var origin=server;C.request(origin+'/identity',{timeout:2000}).then(function(identity){if(server===origin){serverId=(identity.MediaContainer||identity).machineIdentifier||'';put('serverId',serverId);}}).catch(function(){});
      }
    }).catch(function (e) { homeRequest.abort();if (stamp === revision && !e.cancelled) discover(token,activeProfile); });
  }
  function connected(data,prefetch){
    connectionReady = true;
    sections=C.extract(data).items.filter(function(s){return s.type==='movie'||s.type==='show';});
    document.getElementById('connection').textContent=(activeProfile?activeProfile.title:'Home server')+' · Connected';
    if (pendingPreviewId) {
      var id = pendingPreviewId; pendingPreviewId = null;
      if (prefetch) { prefetch.catch(function () {}); if (prefetch.abort) prefetch.abort(); }
      navigation('home'); stack = [{route: homeRoute(), index: null, scrollTop: 0}]; detail(id);
    } else browse(homeRoute(),undefined,prefetch);
  }
  function commitConnection(connection,userToken,profile){
    if (server !== connection.server || (activeProfile ? activeProfile.id : 'owner') !== (profile ? profile.id : 'owner')) disablePreview();
    var session={server:connection.server,serverToken:connection.serverToken,userToken:userToken,machineId:connection.machineId,profile:profile};
    if(!put('session',JSON.stringify(session)))throw new Error('Could not save the profile securely. Free TV storage and try again.');
    server=connection.server;serverToken=connection.serverToken;token=userToken;serverId=connection.machineId;activeProfile=profile;
    put('server',server);put('serverId',serverId);loadPreferences();cache=[];stack=[];connected(connection.sections);
  }
  function discover(userToken,profile){
    var stamp=begin();nav.textContent='';main.appendChild(el('h1','Finding your Plex server…'));
    main.appendChild(btn('Cancel',setup));
    service.resources(userToken).then(function(resources){
      if(stamp!==revision)return;
      var matches=resources.filter(function(resource){return serverId&&resource.clientIdentifier===serverId;});
      if(!matches.length)matches=resources.filter(function(resource){return (resource.connections||[]).some(function(c){return c.uri===server;});});
      function choose(resource){
        main.textContent='';main.appendChild(el('h1','Connecting to '+resource.name+'…'));main.appendChild(btn('Cancel',setup));
        service.connectResource(resource).then(function(connection){if(stamp===revision)commitConnection(connection,userToken,profile);}).catch(function(e){if(stamp===revision)errorPanel(e,function(){discover(userToken,profile);});});
      }
      if(matches.length===1){choose(matches[0]);return;}
      if(resources.length===1){choose(resources[0]);return;}
      main.textContent='';main.appendChild(el('h1',resources.length?'Choose a Plex server':'No servers available to this profile'));
      resources.forEach(function(resource){main.appendChild(btn(resource.name||'Plex server',function(){choose(resource);}));});
      main.appendChild(btn('Connection settings',setup));focusFirst();
    }).catch(function(e){if(stamp===revision)errorPanel(e,function(){discover(userToken,profile);});});
  }
  function browse(target, restoreIndex, prefetch, restoreScroll) {
    if(loadingTarget==='browse:'+target.path)return;
    if (target.kind === 'saved') { savedScreen(restoreIndex, restoreScroll); return; }
    if (target.kind === 'home') { showHome(restoreIndex, prefetch, restoreScroll); return; }
    var stamp = begin(); route = target;loadingTarget='browse:'+target.path;main.setAttribute('aria-busy','true');
    navigation(target.section);
    main.appendChild(el('h1', 'Loading ' + target.title.toLowerCase() + '…'));
    var firstPage=Math.floor((restoreIndex||0)/12);
    var path = libraryPagePath(target,firstPage);
    var hit = cache.filter(function (entry) { return entry.path === path; })[0];
    var result = hit ? Promise.resolve(hit.data) : prefetch||api(path);if(!hit)viewRequest=result;
    result.then(function (data) {
      if (stamp !== revision) return;
      if (!hit) { cache.push({ path: path, data: data }); if (cache.length > 8) cache.shift(); }
      renderGrid(data, target, restoreIndex, restoreScroll);
    }).catch(function (e) {
      if (stamp !== revision) return;
      // Older servers may expose only onDeck; only fallback for an endpoint error.
      if (target.section === 'home' && target.path.indexOf('/hubs/') === 0 && /HTTP (404|400)/.test(e.message)) {
        browse({ title: target.title, path: '/library/onDeck', page: target.page, section: 'home' });
      } else errorPanel(e, function () { browse(target); });
    });
  }
  function libraryPagePath(target,page){return target.path+(target.path.indexOf('?')<0?'?':'&')+C.query({'X-Plex-Container-Start':page*12,'X-Plex-Container-Size':12});}
  function libraryPage(view,page){if(view.savedItems)return {data:{MediaContainer:{Metadata:view.savedItems.slice(page*12,page*12+12)}}};var path=libraryPagePath(view.target,page);return cache.filter(function(entry){return entry.path===path;})[0];}
  function libraryCount(view,data,page){
    var box=data.MediaContainer||data,items=C.extract(data).items;
    if(box.totalSize!==undefined){view.total=Math.max(0,Number(box.totalSize)||0);view.known=true;}
    else if(items.length<12){view.total=page*12+items.length;view.known=true;}
    else if(!view.known)view.total=Math.max(view.total,(page+2)*12);
    view.count.textContent=(view.known?view.total+' items':'Browse to load more')+(view.target.filters&&F.hasLibraryFilters(view.target.filters)?' · Saved filters / sort':'');
    if(view.pendingFocus!==null&&view.pendingFocus>=view.total)view.pendingFocus=view.total?view.total-1:null;
    view.viewport.style.height=Math.max(0,Math.ceil(view.total/view.columns)*view.stride-layout.gap)+'px';
  }
  function requestLibraryPage(view,page){
    if(view!==libraryView||page<0||page*12>=view.total||view.requests[page]||view.errors[page]||libraryPage(view,page))return;
    var path=libraryPagePath(view.target,page),request=api(path);view.requests[page]=request;
    view.status.textContent='Loading more titles…';
    request.then(function(data){
      if(view!==libraryView)return;delete view.requests[page];
      cache.push({path:path,data:data});if(cache.length>8)cache.shift();
      libraryCount(view,data,page);view.version++;renderLibraryWindow(true);
    }).catch(function(error){
      if(view!==libraryView||error.cancelled)return;delete view.requests[page];view.errors[page]=true;
      view.status.textContent='Could not load these titles. Your place is saved.';view.retry.hidden=false;
    });
  }
  function libraryCard(view,item,index){
    var card=mediaCard(item,function(){
      if(view.savedItems&&item.savedState){if(item.savedState==='loading')toast('Loading this saved title…');else savedUnavailable(view,item);return;}
      stack.push({route:view.target,index:index,scrollTop:main.scrollTop});
      if(view.target.showId){rememberSeries(view.target.showId,item.type==='season'?{seasonIndex:index,seasonId:String(item.ratingKey)}:view.target.seasonId?{seasonId:view.target.seasonId,episodeIndex:index,episodeScroll:main.scrollTop}:{allIndex:index,allScroll:main.scrollTop});}
      if(item.type==='season')openSeason(item,view.target.showId||item.parentRatingKey,view.target.section);
      else detail(item.ratingKey);
    },true,view.landscape);
    card.setAttribute('data-library-index',index);card.setAttribute('aria-posinset',index+1);
    if(view.known)card.setAttribute('aria-setsize',view.total);
    return card;
  }
  function mediaCard(item, action, showProgress, landscape) {
    var hidden=F.hideSpoiler(item,prefs),title=hidden?F.episodeLabel(item):item.title||'Untitled';
    var info=item.type==='episode'?(item.grandparentTitle||'')+' · '+F.episodeLabel(item):item.year?String(item.year):item.type==='season'?(item.leafCount||0)+' episodes':'Open library';
    var card=btn('',action,'card'),state=F.cardWatchState(item);
    // Mixed rows share a portrait frame. Episode-only grids share a landscape
    // frame, even when a protected episode uses its show poster as a fallback.
    var artwork=item;
    if(item.type==='episode'&&(hidden||!landscape))artwork={thumb:item.grandparentThumb||item.parentThumb||(!hidden?item.thumb:'')};
    var poster=el('div',undefined,'poster'+(landscape?' episode-still':'')),src=thumb(artwork,240,landscape?135:360);
    if(src){var image=el('img');image.src=src;image.alt='';image.onerror=function(){this.remove();};poster.appendChild(image);}
    poster.appendChild(el('span',title,'placeholder'));card.appendChild(poster);
    card.appendChild(el('span',title,'card-title'));card.appendChild(el('span',info,'card-info'));
    var status=state.inProgress?'In progress':state.watched?'Watched':'Unwatched';
    if(state.showWatched){var badge=el('span','✓','watched-badge');badge.setAttribute('aria-hidden','true');poster.appendChild(badge);}
    if(state.inProgress&&state.progress!==null){
      var progress=el('span',undefined,'card-progress'),fill=el('span',undefined,'card-progress-fill');
      progress.setAttribute('aria-hidden','true');fill.style.width=(state.progress*100)+'%';progress.appendChild(fill);poster.appendChild(progress);
      status+=' · '+Math.ceil(state.remaining/60000)+' min left';
      poster.appendChild(el('span',Math.ceil(state.remaining/60000)+' min left','card-remaining'));
    }
    card.setAttribute('aria-label',title+' · '+info+' · '+status);
    card.onfocus=function(){
      document.getElementById('focused-title').textContent=title;
      document.getElementById('focused-meta').textContent=info+' · '+status;
    };
    return card;
  }
  function renderLibraryWindow(load){
    var view=libraryView;if(!view)return;
    var top=(view.viewport.getBoundingClientRect().top-main.getBoundingClientRect().top)/layout.scale+main.scrollTop;
    var first=Math.max(0,Math.floor((main.scrollTop-top)/view.stride));
    var last=Math.min(Math.ceil(view.total/view.columns),Math.ceil((main.scrollTop+main.clientHeight-top)/view.stride));
    var from=Math.max(0,first-1)*view.columns,to=Math.min(view.total,(last+1)*view.columns),active=document.activeElement;
    var activeIndex=active.hasAttribute('data-library-index')?Number(active.getAttribute('data-library-index')):null;
    var signature=from+':'+to+':'+view.version;
    if(view.signature!==signature){
      var existing={};Array.prototype.forEach.call(view.grid.querySelectorAll('.card'),function(card){existing[card.getAttribute('data-library-index')]=card;});
      view.signature=signature;view.grid.textContent='';view.grid.style.top=Math.floor(from/view.columns)*view.stride+'px';
      var fragment=document.createDocumentFragment();
      for(var index=from;index<to;index++){
        var page=libraryPage(view,Math.floor(index/12)),item=page&&C.extract(page.data).items[index%12];
        if(item)fragment.appendChild(existing[index]||libraryCard(view,item,index));
        else{var placeholder=el('div','Loading…','library-placeholder');placeholder.setAttribute('aria-hidden','true');fragment.appendChild(placeholder);}
      }
      view.grid.appendChild(fragment);
      if(activeIndex!==null&&view.pendingFocus===null)view.pendingFocus=Math.max(first*view.columns,Math.min(to-1,activeIndex));
    }
    if(view.pendingFocus!==null){
      var focus=view.grid.querySelector('[data-library-index="'+view.pendingFocus+'"]');
      if(focus){var scroll=main.scrollTop;focus.focus();main.scrollTop=scroll;view.pendingFocus=null;}
    }
    if(load){
      var firstPage=Math.floor(from/12),lastPage=Math.floor(Math.max(from,to-1)/12);
      Object.keys(view.requests).forEach(function(page){if(Number(page)<firstPage||Number(page)>lastPage){view.requests[page].abort();delete view.requests[page];}});
      for(var p=firstPage;p<=lastPage;p++)requestLibraryPage(view,p);
    }
    var failed=Object.keys(view.errors).length>0;
    view.retry.hidden=!failed;
    view.status.textContent=failed?'Could not load these titles. Your place is saved.':Object.keys(view.requests).length?'Loading more titles…':'';
  }
  function moveLibrary(key){
    var view=libraryView,current=document.activeElement;if(!view)return false;
    var index=view.pendingFocus!==null?view.pendingFocus:current.hasAttribute('data-library-index')?Number(current.getAttribute('data-library-index')):null;
    if(index===null)return false;
    if(key===38&&index<view.columns){view.pendingFocus=null;var section=nav.querySelector('.active');if(section)section.focus();return true;}
    // Horizontal keys stop at row edges; only vertical movement changes rows.
    if ((key===37&&index%view.columns===0)||(key===39&&index%view.columns===view.columns-1)) return true;
    var next=Math.max(0,Math.min(view.total-1,index+(key===37?-1:key===39?1:key===38?-view.columns:view.columns)));
    view.pendingFocus=next;
    var top=(view.viewport.getBoundingClientRect().top-main.getBoundingClientRect().top)/layout.scale+main.scrollTop,rowTop=top+Math.floor(next/view.columns)*view.stride;
    if(rowTop<main.scrollTop+110)main.scrollTop=Math.max(0,rowTop-110);
    else if(rowTop+view.stride-layout.gap>main.scrollTop+main.clientHeight)main.scrollTop=rowTop+view.stride-layout.gap-main.clientHeight;
    renderLibraryWindow(true);return true;
  }
  function renderGrid(data,target,restoreIndex,restoreScroll){
    var renderStart=performance.now(),result=C.extract(data);loadingTarget=null;main.setAttribute('aria-busy','false');main.textContent='';main.classList.add('library-view');focusedItem.hidden=false;
    var heading=el('div',undefined,'page-heading'),count=el('span','','muted');heading.appendChild(el('h1',target.title));heading.appendChild(count);main.appendChild(heading);
    if(target.filters){
      var section=sections.filter(function(s){return s.key===target.section;})[0];
      if(section){
        heading.appendChild(btn('Edit filters',function(){visit(searchScreen);},'library-clear'));
        if(F.hasLibraryFilters(target.filters))heading.appendChild(btn('Clear filters',function(){clearLibraryPreferences(section);},'library-clear'));
      }
      heading.appendChild(el('p',F.filterSummary(target.filters),'filter-summary'));
    }
    var status=el('span','','library-status');status.setAttribute('role','status');
    var retry=btn('Retry loading titles',function(){if(libraryView){libraryView.errors={};renderLibraryWindow(true);}});retry.hidden=true;
    var feedback=el('div',undefined,'library-feedback');feedback.appendChild(status);feedback.appendChild(retry);heading.appendChild(feedback);
    var viewport=el('div',undefined,'library-viewport'),grid=el('div',undefined,'grid library-grid');viewport.appendChild(grid);main.appendChild(viewport);
    var landscape=result.items.length>0&&result.items.every(function(item){return item.type==='episode';})&&target.path.indexOf('/hubs/')!==0&&target.path!=='/library/onDeck';
    var metrics=gridMetrics(landscape);
    var view={target:target,landscape:landscape,viewport:viewport,grid:grid,count:count,status:status,retry:retry,total:0,known:false,columns:metrics.columns,stride:metrics.stride,requests:{},errors:{},version:0,pendingFocus:result.items.length?(restoreIndex||0):null};
    if(target.kind==='saved')view.savedItems=result.items;
    libraryView=view;libraryCount(view,data,Math.floor((restoreIndex||0)/12));
    if(!result.items.length){
      var empty=el('section',undefined,'panel'),filtered=target.filters&&F.hasLibraryFilters(target.filters);
      empty.appendChild(el('h2',filtered?'No matching titles':target.section==='home'?'Ready for something new?':'Nothing here yet'));
      empty.appendChild(el('p',filtered?'Try changing the search or filters for this library.':target.section==='home'?'Choose a movie or TV library above to start watching.':'Refresh after your Plex server has scanned this library.'));

      main.appendChild(empty);focusFirst(filtered?heading:nav);
    }
    main.scrollTop=restoreScroll===undefined?(restoreIndex?Math.floor(restoreIndex/view.columns)*view.stride:0):restoreScroll;
    // A denser viewport can expose more than the first twelve-item page.
    // Fill its visible/overscan rows without requiring a scroll to start loading.
    renderLibraryWindow(true); restoreScreenFocus();
    main.onscroll=function(){cancelAnimationFrame(libraryFrame);libraryFrame=requestAnimationFrame(function(){if(libraryView===view)renderLibraryWindow(true);});};
    measure('grid render',renderStart);if(firstLibrary){measure('startup to library',startedAt);firstLibrary=false;setTimeout(function(){if(document.fonts)document.fonts.load('24px TizenCJK','日本語中文').catch(function(){note('CJK font loading failed');});},1500);}
  }

  function seriesPositions(){
    try{var items=JSON.parse(get('seriesPositions.'+preferenceScope())||'[]');return Array.isArray(items)?items.filter(function(item){return item&&typeof item.id==='string'&&/^[0-9]{1,24}$/.test(item.id);}).slice(-30).map(function(item){
      var clean={id:item.id};if(typeof item.seasonId==='string'&&/^[0-9]{1,24}$/.test(item.seasonId))clean.seasonId=item.seasonId;
      ['seasonIndex','episodeIndex','episodeScroll','allIndex','allScroll'].forEach(function(key){if(typeof item[key]==='number'&&isFinite(item[key]))clean[key]=Math.max(0,Math.min(1000000,Math.floor(item[key])));});return clean;
    }):[];}catch(_){return [];}
  }
  function seriesPosition(id){return seriesPositions().filter(function(item){return item.id===String(id);})[0]||{};}
  function rememberSeries(id,changes){
    if(!id||!/^[0-9]+$/.test(String(id)))return;
    var entries=seriesPositions(),record=seriesPosition(id);
    if(changes.seasonId&&record.seasonId!==changes.seasonId){record.episodeIndex=0;record.episodeScroll=0;}
    record.id=String(id);
    ['seasonIndex','episodeIndex','episodeScroll','allIndex','allScroll'].forEach(function(key){if(changes[key]!==undefined)record[key]=Math.max(0,Math.min(1000000,Math.floor(Number(changes[key])||0)));});
    if(changes.seasonId&&/^[0-9]+$/.test(changes.seasonId))record.seasonId=changes.seasonId;
    entries=entries.filter(function(item){return item.id!==record.id;});entries.push(record);put('seriesPositions.'+preferenceScope(),JSON.stringify(entries.slice(-30)));
  }
  function openSeason(item,showId,section){
    var saved=seriesPosition(showId),same=saved.seasonId===String(item.ratingKey);
    browse({title:item.title,path:'/library/metadata/'+encodeURIComponent(item.ratingKey)+'/children',page:0,section:section||'home',showId:showId,seasonId:String(item.ratingKey)},same?saved.episodeIndex:0,undefined,same?saved.episodeScroll:0);
  }
  function openSeriesEpisodes(item){
    var id=item.type==='show'?item.ratingKey:item.grandparentRatingKey;
    if(!id){toast('Plex did not provide this episode’s show. Open its TV library.');return;}
    var saved=seriesPosition(id);
    visit(function(){browse({title:(item.type==='show'?item.title:item.grandparentTitle||'Series')+' · All episodes',path:'/library/metadata/'+encodeURIComponent(id)+'/allLeaves',page:0,section:'home',showId:String(id)},saved.allIndex||0,undefined,saved.allScroll||0);});
  }
  function seriesLanding(item,stamp){
    main.textContent='';var row=el('section',undefined,'detail series-detail');row.setAttribute('data-rating-key',item.ratingKey);
    var image=el('img',undefined,'detail-poster');image.alt='';var src=thumb(item,420,630);if(src)image.src=src;row.appendChild(image);
    var copy=el('div',undefined,'detail-copy');copy.appendChild(el('div','TV series','eyebrow'));copy.appendChild(el('h1',item.title));
    copy.appendChild(el('div',[item.year,item.childCount?item.childCount+' seasons':'',item.leafCount?item.leafCount+' episodes':''].filter(Boolean).join(' · '),'badges'));
    var actions=el('div',undefined,'detail-actions'),continueItem=null,busy=false;
    var primary=btn('Finding next episode…',function(){
      if(!continueItem||busy)return;busy=true;primary.textContent='Preparing episode…';var scope=preferenceScope();
      viewRequest=api('/library/metadata/'+encodeURIComponent(continueItem.ratingKey)+'?includeChapters=1');
      viewRequest.then(function(data){
        if(stamp!==revision||scope!==preferenceScope())return;
        var episode=C.extract(data).items[0];if(!episode||episode.type!=='episode'||String(episode.grandparentRatingKey)!==String(item.ratingKey))throw new Error('This episode is no longer available in the series.');
        busy=false;primary.textContent=continueLabel(continueItem);play(episode,Number(episode.viewOffset)||0);
      }).catch(function(error){if(stamp===revision&&!error.cancelled){busy=false;primary.textContent=continueLabel(continueItem);toast('Could not prepare the episode. '+C.safeError(error));}});
    },'primary');primary.setAttribute('aria-disabled','true');actions.appendChild(primary);
    actions.appendChild(btn('Seasons & episodes',function(){var saved=seriesPosition(item.ratingKey);visit(function(){browse({title:item.title+' · Seasons',path:'/library/metadata/'+encodeURIComponent(item.ratingKey)+'/children',page:0,section:'home',showId:String(item.ratingKey)},saved.seasonIndex||0);});}));
    copy.appendChild(actions);
    var summary=el('p',item.summary||'No description available.','summary');copy.appendChild(summary);
    var more=btn('Read more',function(){descriptionDialog(item.title,summary.textContent);});copy.appendChild(more);
    saveLaterAction(item,copy);
    copy.appendChild(btn('Show language preferences',function(){visit(function(){showLanguageSettings(item);});}));
    copy.appendChild(btn('All episodes',function(){openSeriesEpisodes(item);}));copy.appendChild(btn('Back',back));
    var status=el('p','','muted');status.setAttribute('role','status');copy.appendChild(status);row.appendChild(copy);main.appendChild(row);more.hidden=summary.scrollHeight<=summary.clientHeight;focusFirst();
    function continueLabel(episode){return (Number(episode.viewOffset)>0?'Continue ':'Play ')+F.episodeLabel(episode);}
    viewRequest=service.continueSeries(item,api);viewRequest.then(function(episode){
      if(stamp!==revision)return;continueItem=episode;
      if(episode){primary.removeAttribute('aria-disabled');primary.textContent=continueLabel(episode);if(document.activeElement===primary)restoreScreenFocus();else restoreScreen=null;}
      else{var focused=document.activeElement===primary;primary.hidden=true;status.textContent='You’re up to date. Choose any episode from Seasons & episodes.';if(focused)actions.children[1].focus();}
    }).catch(function(error){if(stamp===revision&&!error.cancelled){var focused=document.activeElement===primary;primary.hidden=true;status.textContent='Could not find the next episode. Choose one from Seasons & episodes.';if(focused)actions.children[1].focus();}});
  }
  function savedRoute(){return {title:'My List',kind:'saved',section:'saved',path:'/saved'};}
  function savedKey(){return 'savedTitles.'+preferenceScope();}
  function readSaved(){
    var value=localStorage.getItem('tizenosplex.'+savedKey());
    if(!value)return [];
    try{return window.TizenSaved.normalize(JSON.parse(value));}catch(_){throw new Error('The saved list on this TV could not be read.');}
  }
  function writeSaved(list){
    if(put(savedKey(),JSON.stringify(window.TizenSaved.normalize(list))))return true;
    toast('Could not update My List. The previous saved list has been kept.');return false;
  }
  // Shared by movie details and the series landing screen. Only IDs/types persist.
  function saveLaterAction(item,container){
    if(!item||(item.type!=='movie'&&item.type!=='show'))return;
    var scope=preferenceScope(),stamp=revision,button=btn('Save for later',toggle);
    var status=el('span','','muted');status.setAttribute('role','status');
    function refresh(){
      try{var saved=window.TizenSaved.has(readSaved(),String(item.ratingKey));button.textContent=saved?'Remove from My List':'Save for later';button.setAttribute('aria-pressed',saved?'true':'false');return saved;}
      catch(_){status.textContent='My List is unavailable while TV storage cannot be read.';return null;}
    }
    function toggle(){
      if(scope!==preferenceScope()||stamp!==revision)return;
      var list,exists;try{list=readSaved();exists=window.TizenSaved.has(list,String(item.ratingKey));}catch(_){refresh();toast('TV storage could not be read. My List was not changed.');return;}
      var result=exists?{list:window.TizenSaved.remove(list,String(item.ratingKey))}:window.TizenSaved.add(list,{id:String(item.ratingKey),type:item.type});
      if(result.error){status.textContent=result.error==='full'?'My List holds 100 titles. Remove a title before saving another.':'This title cannot be saved.';toast(status.textContent);return;}
      if(!writeSaved(result.list))return;
      refresh();status.textContent=exists?'Removed from My List.':'Saved on this TV for this server and profile.';toast(status.textContent);
    }
    refresh();container.appendChild(button);container.appendChild(status);
  }
  function savedUnavailable(view,item){
    if(view!==libraryView)return;
    openPlaybackMenu('Saved title unavailable',
      'The server could not return this saved '+item.type+'. It stays in My List until you remove it. No media will be deleted.',[
        {label:'Keep saved',selected:true,action:function(){}},
        {label:'Retry this title',keepOpen:true,action:function(){closePlaybackMenu(true);if(view===libraryView)view.retrySaved(String(item.ratingKey));}},
        {label:'Remove from My List',keepOpen:true,action:function(){
          closePlaybackMenu(true);
          if(view!==libraryView)return;
          var list;try{list=readSaved();}catch(_){toast('TV storage could not be read. My List was not changed.');return;}
          if(!writeSaved(window.TizenSaved.remove(list,String(item.ratingKey))))return;
          var index=view.savedItems.indexOf(item),scroll=main.scrollTop;
          toast('Removed from My List.');savedScreen(Math.max(0,Math.min(index,list.length-1)),scroll);
        }}
      ]);
  }
  function savedScreen(restoreIndex,restoreScroll){
    var stamp=begin(),scope=preferenceScope(),entries;
    route=savedRoute();navigation('saved');
    try{entries=readSaved();}catch(error){errorPanel(error,function(){savedScreen();});return;}
    var items=entries.map(function(item){return {ratingKey:item.id,type:item.type,title:'Loading saved '+item.type+'…',savedState:'loading'};});
    renderGrid({MediaContainer:{Metadata:items,totalSize:items.length}},route,restoreIndex,restoreScroll);
    var view=libraryView,heading=main.querySelector('.page-heading');
    heading.appendChild(el('p','Saved on this TV · This server and profile only · '+window.TizenSaved.limit+' titles maximum','filter-summary'));
    if(!items.length){var empty=main.querySelector('.panel');empty.querySelector('h2').textContent='Save something for later';empty.querySelector('p').textContent='Open a movie or series and choose Save for later. Your list stays on this TV; it is separate from Plex Watchlist.';return;}
    var cancelled=false,queue=entries.slice(),running=[],finished=0;
    function active(){return !cancelled&&stamp===revision&&scope===preferenceScope()&&libraryView===view;}
    function replace(id,item){
      var index=view.savedItems.map(function(entry){return String(entry.ratingKey);}).indexOf(id);if(index<0)return;
      var old=view.grid.querySelector('[data-library-index="'+index+'"]'),selected=old===document.activeElement,scroll=main.scrollTop;
      if(selected)view.pendingFocus=index;
      if(old)old.remove();view.savedItems[index]=item;view.version++;renderLibraryWindow(false);main.scrollTop=scroll;
      view.status.textContent=queue.length||running.length?'Loading saved titles… '+finished+' / '+entries.length:'';
    }
    function pump(){
      while(active()&&queue.length&&running.length<3){
        (function(entry){
          var request=api('/library/metadata/'+entry.id,{timeout:6000});running.push(request);
          request.then(function(data){
            if(!active())return;
            var fresh=C.extract(data).items[0];
            if(!fresh||String(fresh.ratingKey)!==entry.id||fresh.type!==entry.type)throw new Error('Saved title is unavailable.');
            fresh.savedState=null;replace(entry.id,fresh);
          }).catch(function(error){
            if(active()&&!error.cancelled)replace(entry.id,{ratingKey:entry.id,type:entry.type,title:'Saved '+entry.type+' '+entry.id+' unavailable',savedState:'unavailable'});
          }).then(function(){
            var index=running.indexOf(request);if(index>=0)running.splice(index,1);finished++;
            if(active()){view.status.textContent=queue.length||running.length?'Loading saved titles… '+finished+' / '+entries.length:'';pump();}
          });
        }(queue.shift()));
      }
    }
    view.retrySaved=function(id){
      if(!active())return;
      var entry=entries.filter(function(value){return value.id===id;})[0];if(!entry)return;
      replace(id,{ratingKey:id,type:entry.type,title:'Loading saved '+entry.type+'…',savedState:'loading'});queue.push(entry);finished=Math.max(0,finished-1);pump();
    };
    viewRequest={abort:function(){cancelled=true;queue=[];running.forEach(function(request){if(request.abort)request.abort();});}};
    pump();
  }
  function detail(id) {
    if(loadingTarget==='detail:'+id)return;
    var stamp = begin(); route = null; screenRenderer=function(){detail(id);};loadingTarget='detail:'+id;main.setAttribute('aria-busy','true');
    main.appendChild(el('h1', 'Opening title…'));
    viewRequest=api('/library/metadata/' + encodeURIComponent(id)+'?includeChapters=1&includeOnDeck=1');viewRequest.then(function (data) {
      if (stamp !== revision) return;
      loadingTarget=null;main.setAttribute('aria-busy','false');
      var item = C.extract(data).items[0];
      if (!item) throw new Error('This title is no longer in the library.');
      if (item.type === 'show') {seriesLanding(item,stamp);return;}
      if (item.type === 'season') {
        openSeason(item,item.parentRatingKey,'home');
        return;
      }
      var recovered=recoveryPoints().filter(function(p){return p.id===String(item.ratingKey)&&p.updated>Number(item.lastViewedAt||0)*1000;})[0];
      if(recovered&&recovered.time>0)item.viewOffset=recovered.time;
      main.textContent = '';
      if(recovered&&recovered.time>0)main.appendChild(el('p','Resume position recovered from the playback interruption on this TV.','muted recovery-notice'));
      var row = el('section', undefined, 'detail');
      row.setAttribute('data-rating-key',item.ratingKey);
      var hidden=F.hideSpoiler(item,prefs);
      var image = el('img', undefined, 'detail-poster'+(item.type==='episode'&&!hidden?' episode-still':'')); image.alt = ''; var src = thumb(hidden?{thumb:item.grandparentThumb}:item, 420, item.type==='episode'&&!hidden?236:630); if (src) image.src = src;
      row.appendChild(image);
      var copy = el('div', undefined, 'detail-copy');
      copy.appendChild(el('div', item.grandparentTitle || (item.type === 'movie' ? 'Movie' : 'Episode'), 'eyebrow'));
      var title=el('h1',hidden?F.episodeLabel(item):item.title);copy.appendChild(title);
      var media = (item.Media || [])[0] || {};
      copy.appendChild(el('div', [item.year, C.duration(item.duration)].filter(Boolean).join('  ·  '), 'badges'));
      var actions=el('div',undefined,'detail-actions');copy.appendChild(actions);
      detailPlaybackActions(item,actions);
      if(item.type==='movie')saveLaterAction(item,copy);
      var summary=el('p',hidden?'Episode details are hidden to avoid spoilers.':item.summary||'No description available.','summary');copy.appendChild(summary);
      var more=btn('Read more',function(){descriptionDialog(title.textContent,summary.textContent);});
      more.hidden=true;copy.appendChild(more);
      var reveal=hidden?btn('Reveal episode details',function(){title.textContent=item.title;summary.textContent=item.summary||'No description available.';image.classList.add('episode-still');var picture=thumb(item,420,236);if(picture)image.src=picture;this.hidden=true;more.hidden=summary.scrollHeight<=summary.clientHeight;actions.querySelector('button').focus();}):null;
      if(reveal)copy.appendChild(reveal);
      if(item.type==='episode'){copy.appendChild(btn('Next episode',function(){nextEpisodeMenu(item);}));if(item.grandparentRatingKey)copy.appendChild(btn('All episodes',function(){openSeriesEpisodes(item);}));if(showPreferenceKey(item))copy.appendChild(btn('Show language preferences',function(){visit(function(){showLanguageSettings(item);});}));}
      watchActions(item,copy,stamp);
      resetProgressAction(item,copy,actions,stamp);
      copy.appendChild(btn('Technical details',function(){openPlaybackMenu('File information','Source file formats; actual playback may use conversion.',[
        {label:[(media.videoCodec||'Unknown video').toUpperCase(),(media.audioCodec||'Unknown audio').toUpperCase(),media.videoResolution?media.videoResolution+'p':''].filter(Boolean).join(' · '),action:function(){}}
      ]);}));
      copy.appendChild(btn('Back', back));
      copy.appendChild(el('p', 'Audio, subtitles and playback information are available in the player controls.', 'muted'));
      row.appendChild(copy); main.appendChild(row); more.hidden=hidden||summary.scrollHeight<=summary.clientHeight;focusFirst();
    }).catch(function (e) { if (stamp === revision) errorPanel(e, function () { detail(id); }); });
  }
  function showLanguageSettings(item){
    var draft=Object.assign(F.showPreferences(basePrefs),showPreference(item)||{}),key=showPreferenceKey(item);
    var panel=settingsPanel('Languages for '+(item.type==='show'?item.title:item.grandparentTitle||'this show'),'Choices apply to this show in the current profile. Track numbers are never remembered.');
    function save(){if(put(key,JSON.stringify(F.showPreferences(draft))))toast('Audio and subtitles saved for this show.');}
    selectField(panel,'Show audio language',F.languages,draft.audioLanguage,function(value){draft.audioLanguage=value;delete draft.audioTraits;save();});
    selectField(panel,'Show subtitle language',F.languages,draft.subtitleLanguage,function(value){draft.subtitleLanguage=value;delete draft.subtitleTraits;save();});
    selectField(panel,'Show subtitles',[['default','Follow file / Plex default'],['always','Always when available'],['foreign','When audio differs from preferred audio'],['off','Off']],draft.subtitleMode,function(value){draft.subtitleMode=value;save();});
    main.appendChild(btn('Use profile defaults for this show',function(){remove(key);toast('Saved show choices cleared. Profile defaults will apply next time.');back();}));
    main.appendChild(btn(item.type==='show'?'Back to series':'Back to episode',back));focusFirst();
  }
  function detailPlaybackActions(item,actions){
    actions.textContent='';
    if(item.viewOffset>0)actions.appendChild(btn('Resume at '+C.duration(item.viewOffset),function(){play(item,item.viewOffset);},'primary'));
    actions.appendChild(btn(item.viewOffset>0?'Play from beginning':'Play',function(){play(item,0);},item.viewOffset>0?'':'primary'));
  }
  function resetProgressAction(item,container,actions,stamp){
    if((item.type!=='movie'&&item.type!=='episode')||!(Number(item.viewOffset)>0))return;
    var busy=false,previous=null,scope=preferenceScope(),epoch=accountEpoch,key='recoveryPositions.'+scope,operation=epoch+':'+scope+':'+item.ratingKey;
    var reset=btn('Reset playback progress',confirm),undo=btn('Undo progress reset',function(){if(previous!==null)write(previous,true);});
    var status=el('p','','muted');status.setAttribute('role','status');undo.hidden=true;
    function confirm(){
      if(busy||stamp!==revision)return;
      openPlaybackMenu('Reset playback progress?',
        'Clear this title\'s resume position on Plex and this TV. Watched status stays unchanged.'+
        (item.type==='episode'?' Plex may still recommend this or the next episode in Continue Watching.':''),[
          {label:'Cancel',selected:true,action:function(){}},
          {label:'Reset progress',action:function(){write(0,false);}}
        ]);
    }
    function write(time,isUndo){
      if(busy||progressWrites[operation]||stamp!==revision||scope!==preferenceScope()||epoch!==accountEpoch)return;
      progressWrites[operation]=true;
      busy=true;reset.disabled=true;undo.disabled=true;
      var requestedAt=Date.now(),oldOffset=Number(item.viewOffset)||0;
      var buttons=Array.prototype.slice.call(container.querySelectorAll('button')).filter(function(button){return !button.disabled;});
      buttons.forEach(function(button){button.disabled=true;});
      status.textContent=isUndo?'Restoring progress\u2026':'Resetting progress\u2026';
      // A stopped timeline updates the resume position without a watched/unwatched mutation.
      api('/:/timeline?'+C.query({ratingKey:item.ratingKey,key:'/library/metadata/'+item.ratingKey,state:'stopped',time:Math.floor(time),duration:Math.floor(Number(item.duration)||0)}),{noBody:true}).then(function(){
        if(epoch!==accountEpoch)return;
        // Finish the original scope even if the user has since changed screens/profiles.
        // Retain any newer recovery checkpoint created after this request began.
        try{
          var points=JSON.parse(get(key)||'[]');
          if(Array.isArray(points))put(key,JSON.stringify(points.filter(function(point){return !point||String(point.id)!==String(item.ratingKey)||Number(point.updated)>requestedAt;})));
        }catch(_){/* Leave malformed storage for its normal recovery validation. */}
        if(scope!==preferenceScope())return;
        cache=[];
        if(stamp!==revision){
          if(route&&!player.active&&!playbackAttempt){
            var focused=document.activeElement,index=focused.hasAttribute('data-library-index')?Number(focused.getAttribute('data-library-index')):focused.getAttribute('data-home-focus');
            if(nav.contains(focused))restoreScreen={focus:focusIdentity(),scrollTop:main.scrollTop};
            returningScreen=true;
            try{browse(route,index,undefined,main.scrollTop);}finally{returningScreen=false;}
          }else if(!player.active&&!playbackAttempt){
            var currentDetail=main.querySelector('.detail');
            if(loadingTarget==='detail:'+item.ratingKey||(currentDetail&&currentDetail.getAttribute('data-rating-key')===String(item.ratingKey)))detail(item.ratingKey);
          }
          return;
        }
        previous=isUndo?null:oldOffset;item.viewOffset=time;
        var notice=main.querySelector('.recovery-notice');if(notice)notice.remove();
        detailPlaybackActions(item,actions);reset.hidden=time===0;undo.hidden=previous===null;
        status.textContent=isUndo?'Previous resume position restored.':'Playback progress reset. Watched status unchanged.';
      }).catch(function(error){
        if(stamp===revision&&scope===preferenceScope()&&epoch===accountEpoch)status.textContent='Could not '+(isUndo?'restore':'reset')+' progress. Try again. '+C.safeError(error);
      }).then(function(){
        delete progressWrites[operation];busy=false;reset.disabled=false;undo.disabled=false;buttons.forEach(function(button){button.disabled=false;});
        if(stamp===revision&&scope===preferenceScope()&&epoch===accountEpoch)(undo.hidden?reset:undo).focus();
      });
    }
    container.appendChild(reset);container.appendChild(undo);container.appendChild(status);
  }
  function watchActions(item,container,stamp){
    var watched=Number(item.viewCount)>0,previous=null,busy=false,scope=preferenceScope(),epoch=accountEpoch,operation=epoch+':'+scope+':'+item.ratingKey;
    var toggle=btn(watched?'Mark unwatched':'Mark watched',function(){write(!watched,false);}),undo=btn('Undo watched status change',function(){if(previous!==null)write(previous,true);});undo.hidden=true;
    toggle.id='watch-status-toggle';undo.id='watch-status-undo';
    var status=el('span',watched?'Watched':'Unwatched','watch-status');status.setAttribute('role','status');
    function refreshCurrentView(){
      if(player.active||playbackAttempt)return;
      var currentDetail=main.querySelector('.detail'),sameDetail=loadingTarget==='detail:'+item.ratingKey||(currentDetail&&currentDetail.getAttribute('data-rating-key')===String(item.ratingKey));
      if(!route&&!sameDetail)return;
      var focused=document.activeElement,scroll=main.scrollTop,index=focused.hasAttribute('data-library-index')?Number(focused.getAttribute('data-library-index')):focused.getAttribute('data-home-focus');
      if(nav.contains(focused)||sameDetail)restoreScreen={focus:focusIdentity(),scrollTop:scroll};
      // A cached page or an already pending metadata request may predate the
      // successful mutation. Restart it within this profile, preserving focus.
      loadingTarget=null;returningScreen=true;
      try{if(route)browse(route,index,undefined,scroll);else detail(item.ratingKey);}finally{returningScreen=false;}
    }
    function write(value,isUndo){
      if(busy||stamp!==revision||scope!==preferenceScope()||epoch!==accountEpoch)return;
      if(watchWrites[operation]){toast('Wait for the watched status update to finish.');return;}
      watchWrites[operation]=true;busy=true;toggle.disabled=true;undo.disabled=true;
      api('/:/'+(value?'scrobble':'unscrobble')+'?'+C.query({key:item.ratingKey,identifier:'com.plexapp.plugins.library'}),{method:'PUT',noBody:true}).then(function(){
        if(scope!==preferenceScope()||epoch!==accountEpoch)return;
        cache=[];
        if(stamp!==revision){refreshCurrentView();return;}
        previous=isUndo?null:watched;watched=value;item.viewCount=value?1:0;
        toggle.textContent=watched?'Mark unwatched':'Mark watched';status.textContent=watched?'Watched':'Unwatched';undo.hidden=previous===null;
        if(isUndo)toggle.focus();
      }).catch(function(error){if(scope===preferenceScope()&&epoch===accountEpoch)toast('Could not change watched status: '+C.safeError(error));}).then(function(){delete watchWrites[operation];busy=false;toggle.disabled=false;undo.disabled=false;});
    }
    container.appendChild(toggle);container.appendChild(undo);container.appendChild(status);
  }
  function nextEpisodeMenu(item){
    if(playbackAttempt&&(!player.started||player.seeking)){toast('Wait for playback or seeking to finish.');return;}
    openPlaybackMenu('Next episode','Finding the next episode. Nothing will play automatically.',[{label:player.active?'Keep watching':'Stay here',selected:true,action:function(){}}]);
    var epoch=menuEpoch,stamp=revision,attempt=playbackAttempt;
    nextRequest=service.nextEpisode(item,api);
    nextRequest.then(function(next){
      if(epoch!==menuEpoch||stamp!==revision||attempt!==playbackAttempt)return;nextRequest=null;
      if(!next){document.getElementById('playback-menu-hint').textContent='This is the last available episode. Nothing will play automatically.';return;}
      var label=F.episodeLabel(next)+(F.hideSpoiler(next,prefs)?'':' · '+(next.title||'Episode'));
      openPlaybackMenu('Next episode',label+' — only starts when you choose Play next episode.',[
        {label:player.active?'Keep watching':'Stay here',selected:true,action:function(){}},
        {label:'Play next episode',keepOpen:true,action:function(){
          if(player.seeking){toast('Wait for seeking to finish.');return;}
          var choiceEpoch=menuEpoch;
          Array.prototype.forEach.call(menuOptions.querySelectorAll('button'),function(button){if(button.textContent==='Play next episode')button.disabled=true;});
          nextRequest=api('/library/metadata/'+encodeURIComponent(next.ratingKey)+'?includeChapters=1');
          nextRequest.then(function(data){
            if(choiceEpoch!==menuEpoch||attempt!==playbackAttempt||stamp!==revision)return;
            var full=C.extract(data).items[0];if(!full||full.type!=='episode')throw new Error('Plex did not return a playable next episode.');C.primaryPart(full);
            if(player.seeking)throw new Error('Wait for seeking to finish, then choose the next episode again.');
            nextRequest=null;closePlaybackMenu(false);
            if(player.active){pendingNextItem=full;stopPlayback();}else play(full,Number(full.viewOffset)||0);
          }).catch(function(error){if(choiceEpoch===menuEpoch&&!error.cancelled){toast(C.safeError(error));Array.prototype.forEach.call(menuOptions.querySelectorAll('button'),function(button){button.disabled=false;});}});
        }}
      ]);
    }).catch(function(error){if(epoch===menuEpoch&&!error.cancelled){document.getElementById('playback-menu-hint').textContent=C.safeError(error);menuOptions.insertBefore(btn('Retry finding next episode',function(){nextEpisodeMenu(item);}),menuOptions.firstChild);}});
  }
  function playbackInformation(){
    if(!playbackAttempt)return;var attempt=playbackAttempt,item=attempt.item,media=C.primaryPart(item).media;
    openPlaybackMenu('Playback information','Formats reported by this file, the TV and Plex.',[]);
    var panel=el('div',undefined,'playback-information'),epoch=menuEpoch;
    menuOptions.insertBefore(panel,menuOptions.firstChild);
    function format(value){return value?String(value).replace(/[^a-zA-Z0-9 ._/-]/g,'').slice(0,45):'Not reported';}
    function render(session){
      panel.textContent='';
      function row(label,value){var line=el('p');line.appendChild(el('strong',label+': '));line.appendChild(document.createTextNode(value));panel.appendChild(line);}
      row('Playback',attempt.mode==='direct'?'Direct play':attempt.mode==='remux'?'Compatibility stream · video copy requested':'Compatibility stream · video conversion requested');
      row('Source video',format(media.videoCodec)+' · '+(media.width&&media.height?media.width+' × '+media.height:format(media.videoResolution)));
      var codecs=[];(C.primaryPart(item).part.Stream||[]).forEach(function(stream){if(Number(stream.streamType)===2&&stream.codec&&codecs.indexOf(stream.codec)<0)codecs.push(stream.codec);});
      row('File audio tracks',(codecs.length?codecs:[media.audioCodec]).map(format).join(', '));
      var current=[];try{if(player.started&&!player.seeking)current=player.av.getCurrentStreamInfo();}catch(_){}
      current.filter(function(track){return track.type==='VIDEO'||track.type==='AUDIO';}).forEach(function(track){var info={};try{info=JSON.parse(track.extra_info||'{}');}catch(_){}row(track.type==='VIDEO'?'TV video':'TV audio',format(info.fourCC)+(info.channels?' · '+format(info.channels)+' channels':''));});
      if(attempt.mode!=='direct'){
        row('Server video',session?format(session.videoDecision)+' · '+format(session.videoCodec):'Decision not confirmed');
        row('Server audio',session?format(session.audioDecision)+' · '+format(session.audioCodec):'Decision not confirmed');
        row('Reason',attempt.burn?'Selected subtitles are rendered into the picture.':prefs.playbackMode==='convert'?'Compatibility mode was selected.':attempt.index>0?'The TV could not play the previous stream.':'The selected source audio needs a compatible stream.');
      }
      var subtitle=attempt.burn?'Rendered into video':externalSubtitle?(externalSubtitle.displayTitle||externalSubtitle.language||F.trackLanguage(externalSubtitle))+' · external text':player.currentTrack('TEXT')===-1?'Off':'TV text track';
      if(!attempt.burn&&!externalSubtitle){try{var track=availableTracks('TEXT').filter(function(t){return t.index===player.currentTrack('TEXT');})[0];if(track)subtitle=C.trackLabel(track,track.index);}catch(_){}}
      row('Subtitles',subtitle);row('Language preferences',showPreference(item)?'Saved for this show':'Profile defaults');
    }
    render(null);
    if(attempt.session){var sessionId=attempt.session.id;api('/transcode/sessions',{timeout:4000}).then(function(data){if(epoch!==menuEpoch||attempt!==playbackAttempt||!attempt.session||sessionId!==attempt.session.id)return;var sessions=(data.MediaContainer||data).TranscodeSession||[];var own=sessions.filter(function(session){return session.key===sessionId||session.key==='/transcode/sessions/'+sessionId;})[0];render(own||null);}).catch(function(){if(epoch===menuEpoch)document.getElementById('playback-menu-hint').textContent='Plex did not provide session details. TV-reported formats are shown where available.';});}
  }

  function libraryRoute(section,filters){filters=filters===undefined?libraryPreferences(section):F.libraryFilters(filters);return {title:filters.title?'Search: '+filters.title:section.title,path:F.libraryPath(section.key,filters),page:0,section:section.key,filters:filters};}
  function selectField(parent,label,values,value,change){
    var wrap=el('div',undefined,'setting-field'),caption=el('label',label),select=el('select');
    select.id='setting-'+label.toLowerCase().replace(/[^a-z0-9]+/g,'-');caption.htmlFor=select.id;
    values.forEach(function(entry){var option=el('option',entry[1]);option.value=String(entry[0]);select.appendChild(option);});
    select.value=String(value);select.onchange=function(){change(select.value);};
    function choose(){select.focus();openPlaybackMenu(label,'Up / Down to choose · OK to select · Back to close',Array.prototype.map.call(select.options,function(option){return {label:option.textContent,selected:option.value===select.value,action:function(){select.value=option.value;change(select.value);}};}));}
    select.onkeydown=function(event){if(event.keyCode===13||event.keyCode===32){event.preventDefault();event.stopPropagation();choose();}};
    select.onmousedown=function(event){event.preventDefault();choose();};
    wrap.appendChild(caption);wrap.appendChild(select);parent.appendChild(wrap);return select;
  }
  function settingsPanel(title,description){
    begin();route=null;main.appendChild(el('h1',title));main.appendChild(el('p',description,'muted'));
    var panel=el('section',undefined,'settings-panel');main.appendChild(panel);return panel;
  }
  function playbackSettings(){
    var panel=settingsPanel('Playback & languages','Preferences are saved for '+(activeProfile?activeProfile.title:'this Plex account')+'. Missing languages fall back to the file’s available tracks.');
    selectField(panel,'Preferred audio',F.languages,prefs.audioLanguage,function(value){prefs.audioLanguage=value;savePreferences();});
    selectField(panel,'Preferred subtitles',F.languages,prefs.subtitleLanguage,function(value){prefs.subtitleLanguage=value;savePreferences();});
    selectField(panel,'When to show subtitles',[['default','Follow file / Plex default'],['always','Always when available'],['foreign','When audio differs from preferred audio'],['off','Off']],prefs.subtitleMode,function(value){prefs.subtitleMode=value;savePreferences();});
    selectField(panel,'Playback mode',[['auto','Automatic · direct first, convert only if needed'],['direct','Direct play only'],['convert','Compatibility · H.264 video / AAC audio']],prefs.playbackMode,function(value){prefs.playbackMode=value;savePreferences();});
    selectField(panel,'Timeline preview images',[['yes','On · when Plex has generated them'],['no','Off']],prefs.previewImages?'yes':'no',function(value){prefs.previewImages=value==='yes';savePreferences();});
    selectField(panel,'Episode spoilers',[['hide','Hide unwatched episode details'],['show','Show all episode details']],prefs.spoilerFree?'hide':'show',function(value){prefs.spoilerFree=value==='hide';savePreferences();cache=[];});
    main.appendChild(el('p','Direct play sends the original file unchanged. Repackaging can keep the video while fixing the container or audio. Conversion creates a compatible stream on your Plex server; it can take longer to start, use server resources and reduce quality.','help-copy'));
    main.appendChild(btn('Back to settings',back));focusFirst();
  }
  function subtitleSettings(inPlayback){
    if(inPlayback===true){
      if(playbackAttempt&&playbackAttempt.burn){closePlaybackMenu(true);toast('These subtitles are rendered into the video by Plex. Choose a TV text track or an external SRT for appearance and timing controls.');return;}
      openPlaybackMenu('Subtitle appearance','Choose a control. Text styles apply to rendered subtitles; burned-in image subtitles are part of the video.',[
        {label:'Size: '+prefs.subtitleSize+' px',action:function(){subtitleChoiceMenu('Subtitle size',[32,40,48,56,64,80,96],'subtitleSize');},keepOpen:true,child:true},
        {label:'Background: '+prefs.subtitleBackground,action:function(){subtitleChoiceMenu('Subtitle background',['box','solid','shadow'],'subtitleBackground');},keepOpen:true,child:true},
        {label:'Color: '+prefs.subtitleColor,action:function(){subtitleChoiceMenu('Subtitle color',['white','yellow'],'subtitleColor');},keepOpen:true,child:true},
        {label:'Position: '+prefs.subtitlePosition,action:function(){subtitleChoiceMenu('Subtitle position',['bottom','top'],'subtitlePosition');},keepOpen:true,child:true},
        {label:'Timing: '+(prefs.subtitleDelay/1000).toFixed(1)+' seconds',action:function(){subtitleTimingMenu();},keepOpen:true,child:true}
      ],function(){subtitleSettings(true);});return;
    }
    var panel=settingsPanel('Subtitles & accessibility','A live preview helps you choose readable text. Settings are saved for the current profile.');
    selectField(panel,'Subtitle size',[32,40,48,56,64,80,96].map(function(size){return [size,size+' px'];}),prefs.subtitleSize,function(value){prefs.subtitleSize=Number(value);savePreferences();});
    selectField(panel,'Subtitle background',[['box','Dark box behind text'],['solid','Solid black · maximum contrast'],['shadow','Outline / shadow only']],prefs.subtitleBackground,function(value){prefs.subtitleBackground=value;savePreferences();});
    selectField(panel,'Subtitle color',[['white','White'],['yellow','Yellow']],prefs.subtitleColor,function(value){prefs.subtitleColor=value;savePreferences();});
    selectField(panel,'Subtitle position',[['bottom','Bottom'],['top','Top']],prefs.subtitlePosition,function(value){prefs.subtitlePosition=value;savePreferences();});
    selectField(panel,'Subtitle weight',[['normal','Normal'],['bold','Bold']],prefs.subtitleWeight,function(value){prefs.subtitleWeight=value;savePreferences();});
    selectField(panel,'Interface text',[['normal','Normal'],['large','Larger text']],prefs.largeUI?'large':'normal',function(value){prefs.largeUI=value==='large';savePreferences();});
    var layout=el('div',undefined,'accessibility-layout'),preview=el('div',undefined,'subtitle-preview');
    preview.appendChild(el('span','Subtitles\n日本語の字幕\n中文字幕','subtitle-sample'));
    main.insertBefore(layout,panel);layout.appendChild(panel);layout.appendChild(preview);
    main.appendChild(el('p','Japanese glyphs are bundled for offline use. Text subtitles can be resized and recolored. Image-based or burned-in subtitles cannot be restyled as text. Subtitle timing can be adjusted during playback.','help-copy'));
    main.appendChild(btn('Back to settings',back));applySubtitleStyle();focusFirst();
  }
  function subtitleChoiceMenu(title,values,key){openPlaybackMenu(title,'Choose a setting; the change applies immediately.',values.map(function(value){return {label:String(value)+(key==='subtitleSize'?' px':''),selected:prefs[key]===value,action:function(){prefs[key]=value;savePreferences();}};}));}
  function subtitleTimingMenu(){
    openPlaybackMenu('Subtitle timing','Positive values show subtitles later. Current offset: '+(prefs.subtitleDelay/1000).toFixed(1)+' seconds.',[
      {label:'Earlier by 0.5 seconds',action:function(){changeSubtitleDelay(-500);}},
      {label:'Later by 0.5 seconds',action:function(){changeSubtitleDelay(500);}},
      {label:'Reset timing',action:function(){changeSubtitleDelay(-prefs.subtitleDelay);}}
    ]);
  }
  function changeSubtitleDelay(delta){
    if(playbackAttempt&&playbackAttempt.burn){toast('Plex-rendered subtitles cannot be retimed here.');return;}
    var next=Math.max(-10000,Math.min(10000,prefs.subtitleDelay+delta));
    if(!externalSubtitle)player.subtitleDelay(next);
    prefs.subtitleDelay=next;savePreferences();renderExternalSubtitle();toast('Subtitle timing: '+(next/1000).toFixed(1)+' seconds');
  }
  function applySubtitleStyle(){
    if(!prefs)return;
    document.body.classList.toggle('large-ui',prefs.largeUI);
    gridMetrics();
    var subtitle=document.getElementById('subtitles');
    subtitle.classList.toggle('subtitle-top',prefs.subtitlePosition==='top');
    subtitle.style.top=prefs.subtitlePosition==='top'?'60px':'auto';subtitle.style.bottom=prefs.subtitlePosition==='bottom'?'75px':'auto';
    Array.prototype.forEach.call(document.querySelectorAll('#subtitle-text,.subtitle-sample'),function(text){
      text.style.fontSize=prefs.subtitleSize+'px';text.style.fontWeight=prefs.subtitleWeight==='bold'?'700':'400';
      text.style.color=prefs.subtitleColor==='yellow'?'#fff36a':'#fff';
      text.style.backgroundColor=prefs.subtitleBackground==='solid'?'#000':prefs.subtitleBackground==='box'?'rgba(0,0,0,.8)':'transparent';
      text.style.textShadow='-2px -2px 2px #000, 2px 2px 2px #000, -2px 2px 2px #000, 2px -2px 2px #000';
    });
  }
  function searchScreen(){
    if(!sections.length){toast('Connect to a server with movie or TV libraries first.');return;}
    var previous=route,stamp=begin();route=null;
    main.appendChild(el('h1','Search & filter'));
    var panel=el('section',undefined,'settings-panel');main.appendChild(panel);
    var chosen=sections.filter(function(section){return previous&&section.key===previous.section;})[0]||sections[0];
    var filters=F.libraryFilters(previous&&previous.filters||libraryPreferences(chosen)),filterEpoch=0;
    var library=selectField(panel,'Library',sections.map(function(section){return [section.key,section.title];}),chosen.key,function(){chosen=sections.filter(function(section){return section.key===library.value;})[0];filters=libraryPreferences(chosen);input.value=filters.title;sort.value=filters.sort;watched.value=filters.unwatched?'unwatched':'all';loadFilters();});
    var field=el('div',undefined,'setting-field'),label=el('label','Title contains'),input=el('input');input.id='title-search';label.htmlFor=input.id;input.value=filters.title||'';input.placeholder='Search titles, including 日本語';input.maxLength=100;field.appendChild(label);field.appendChild(input);panel.appendChild(field);
    var sort=selectField(panel,'Sort',[['titleSort:asc','Title A–Z'],['addedAt:desc','Recently added'],['year:desc','Newest release'],['rating:desc','Highest rated']],filters.sort||'titleSort:asc',function(){});
    var watched=selectField(panel,'Watch status',[['all','All titles'],['unwatched','Unwatched']],filters.unwatched?'unwatched':'all',function(){});
    var genre=selectField(panel,'Genre',[['','All genres']],filters.genre||'',function(){}),year=selectField(panel,'Year',[['','All years']],filters.year||'',function(){});
    function loadFilters(){
      var selected=library.value,epoch=++filterEpoch;
      [['genre',genre,'All genres'],['year',year,'All years']].forEach(function(entry){
        entry[1].textContent='';var all=el('option',entry[2]);all.value='';entry[1].appendChild(all);
        if(filters[entry[0]]){var saved=el('option','Saved selection');saved.value=filters[entry[0]];entry[1].appendChild(saved);entry[1].value=saved.value;}
        api('/library/sections/'+encodeURIComponent(selected)+'/'+entry[0],{timeout:4000}).then(function(data){
          if(stamp!==revision||library.value!==selected||epoch!==filterEpoch)return;
          var currentValue=entry[1].value;entry[1].textContent='';entry[1].appendChild(all);
          C.extract(data).items.slice(0,300).forEach(function(item){var option=el('option',item.title||item.tag);option.value=String(item.key||item.id||item.title).split('/').pop();entry[1].appendChild(option);});
          if(currentValue&&!Array.prototype.some.call(entry[1].options,function(option){return option.value===currentValue;})){var missing=el('option','Saved selection (unavailable)');missing.value=currentValue;entry[1].appendChild(missing);}entry[1].value=currentValue;
        }).catch(function(){ /* Title and watch-status search still work without filter metadata. */ });
      });
    }
    function submit(){
      var section=sections.filter(function(item){return item.key===library.value;})[0];
      function chosenLabel(select){var option=select.options[select.selectedIndex];return select.value&&option&&option.textContent.indexOf('Saved selection')!==0?option.textContent:'';}
      var values=F.libraryFilters({title:input.value,sort:sort.value,unwatched:watched.value==='unwatched',genre:genre.value,year:year.value,genreLabel:chosenLabel(genre)||filters.genreLabel,yearLabel:chosenLabel(year)||filters.yearLabel});
      put(libraryPreferenceKey(section),JSON.stringify(values));
      if(values.title)put(recentSearchKey(),JSON.stringify(F.addRecentSearch(readRecentSearches(),values.title)));
      stack=[];browse(libraryRoute(section,values));
    }
    main.appendChild(btn('Show results',submit,'primary'));main.appendChild(btn('Clear filters',function(){clearLibraryPreferences(chosen);}));
    input.onkeydown=function(event){if(event.keyCode===13){event.preventDefault();submit();}};
    var history=el('section',undefined,'recent-searches');main.appendChild(history);
    function showHistory(){
      history.textContent='';var entries=readRecentSearches();if(!entries.length)return;
      history.appendChild(el('h2','Recent searches'));
      entries.forEach(function(query){history.appendChild(btn(query,function(){input.value=query;submit();}));});
      history.appendChild(btn('Clear history',function(){remove(recentSearchKey());showHistory();input.focus();toast('Recent searches cleared for this server and profile.');}));
    }
    showHistory();loadFilters();input.focus();
  }
  function profiles(){
    var stamp=begin();route=null;nav.textContent='';main.appendChild(el('h1','Plex Home profiles'));
    main.appendChild(el('p','Loading profiles…'));
    service.users(accountToken).then(function(users){
      if(stamp!==revision)return;
      main.textContent='';main.appendChild(el('h1','Who’s watching?'));
      users.forEach(function(user){main.appendChild(btn(user.title+(user.protected?' · PIN required':''),function(){visit(function(){profilePin(user);});}));});
      if(!users.length)main.appendChild(el('p','No Plex Home profiles were returned for this account.'));
      main.appendChild(btn('Back',back));focusFirst();
    }).catch(function(e){if(stamp===revision)errorPanel(e,profiles);});
  }
  function profilePin(user){
    var stamp=begin();main.appendChild(el('h1','Switch to '+user.title));
    var input=el('input');input.id='profile-pin';input.type='password';input.inputMode='numeric';input.maxLength=4;input.autocomplete='off';
    if(user.protected){var label=el('label','Plex Home PIN');label.htmlFor=input.id;main.appendChild(label);main.appendChild(input);}
    main.appendChild(el('p','Watch history, available libraries and preferences will use this profile. Your PIN is sent to Plex over HTTPS and is not saved.','help-copy'));
    var choose=btn('Switch profile',function(){
      if(user.protected&&!/^\d{4}$/.test(input.value)){toast('Enter this profile’s four-digit PIN.');input.focus();return;}
      var pin=input.value;input.value='';choose.disabled=true;
      service.switchUser(accountToken,user.id,pin).then(function(userToken){if(stamp===revision)discover(userToken,user);}).catch(function(e){if(stamp===revision){choose.disabled=false;toast(e.status===401||e.status===403?'Plex rejected this PIN or profile. Try again.':C.safeError(e));if(user.protected)input.focus();}});
    },'primary');
    main.appendChild(choose);main.appendChild(btn('Cancel',back));if(user.protected)input.focus();else choose.focus();
  }
  function screensaver(on) {
    try { if (window.webapis && webapis.appcommon) webapis.appcommon.setScreenSaver(on ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF); } catch (_) { note('Screen saver control unavailable'); }
  }
  var player = new TizenPlexPlayer(window.webapis && webapis.avplay, {
    state: function (state) { document.getElementById('control-toggle').textContent=state==='paused'?'Play':'Pause'; note('Player: ' + state); screensaver(state !== 'playing');subtitleAnchor=performance.now();updateSubtitleClock();updatePlaybackContext(false); },
    ready: function(){
      if(playbackAttempt){playbackAttempt.played=true;measure('play to ready: '+playbackAttempt.mode,playbackAttempt.startedAt);}
      applyTrackPreferences();updateSubtitleClock();
    },
    buffer: function (loading, percent) { document.getElementById('player-message').textContent = loading ? 'Loading video' + (percent === undefined ? '…' : ' · ' + percent + '%') : ''; },
    subtitle: function (text) { if(!externalSubtitle)setSubtitleText(S.clean(text)); },
    progress: function (time, total) {
      subtitleAnchor=performance.now();renderExternalSubtitle();
      document.getElementById('playback-time').textContent = C.duration(time) + ' / ' + C.duration(total);
      document.getElementById('progress-fill').style.width = (total ? Math.max(0, Math.min(100, time / total * 100)) : 0) + '%';
      if(!controls.hidden)updatePlaybackContext(false);
    },
    report: function (item, state, time, total) {
      var reportedAt=Date.now(),scope=preferenceScope();
      api('/:/timeline?' + C.query({ ratingKey: item.ratingKey, key: '/library/metadata/' + item.ratingKey, state: state, time: Math.floor(time), duration: Math.floor(total) }), { noBody: true }).then(function(){if(scope===preferenceScope())clearRecoveryPosition(item,reportedAt);}).catch(function () { /* Recorded in diagnostics; playback continues. */ });
    },
    notice: toast,
    stopped: function (result) {
      finishPlayback(result&&result.completed);
    },
    error: function (error,context) { note(error);if(playbackAttempt&&!playbackAttempt.cancelled){playbackAttempt.offset=context.time;playbackAttempt.lastError=error;if(context.started||isConnectionFailure(error))playbackRecovery(error);else tryPlayback();}else{finishPlayback();toast('Playback stopped: '+C.safeError(error));} }
  });
  function setSubtitleText(text){var node=document.getElementById('subtitle-text');if(node.textContent!==text)node.textContent=text;}
  function clearSubtitles(){subtitleEpoch++;if(subtitleRequest&&subtitleRequest.abort)subtitleRequest.abort();subtitleRequest=null;clearInterval(subtitleTimer);subtitleTimer=null;subtitleCues=[];externalSubtitle=null;setSubtitleText('');}
  function renderExternalSubtitle(){
    if(!externalSubtitle||!player.started||player.seeking)return;
    var time=player.time+(player.state==='playing'?Math.min(1000,performance.now()-subtitleAnchor):0)-prefs.subtitleDelay;
    setSubtitleText(S.at(subtitleCues,time));
  }
  function updateSubtitleClock(){
    clearInterval(subtitleTimer);subtitleTimer=null;
    if(externalSubtitle&&player.state==='playing')subtitleTimer=setInterval(renderExternalSubtitle,100);
    renderExternalSubtitle();
  }
  function cleanupTranscode(){
    if(!playbackAttempt||!playbackAttempt.session)return;
    var session=playbackAttempt.session;playbackAttempt.session=null;
    C.request(session.server+'/video/:/transcode/universal/stop?'+C.query({session:session.id}),{headers:session.headers,noBody:true,timeout:4000}).catch(function(){note('Transcoder session cleanup could not be confirmed.');});
  }
  function finishPlayback(completed){
    var completedItem=completed&&playerReturn&&playerReturn.type==='episode'?playerReturn:null;
    playbackEpoch++;if(playbackRequest&&playbackRequest.abort)playbackRequest.abort();playbackRequest=null;
    cleanupTranscode();playbackAttempt=null;clearSubtitles();closePlaybackMenu(false);
    clearTimeout(controlsTimer);playerUI.hidden=true;shell.hidden=false;screensaver(true);cache=[];
    loadPreferences();
    if(pendingNextItem){var next=pendingNextItem;pendingNextItem=null;play(next,Number(next.viewOffset)||0);return;}
    if(completedItem){episodeComplete(completedItem);return;}
    if(playerReturn)detail(playerReturn.ratingKey);
  }
  function episodeComplete(item){
    var stamp=begin(),scope=preferenceScope(),nextItem=null,busy=false;
    route=null;screenRenderer=function(){episodeComplete(item);};navigation('');
    var panel=el('section',undefined,'panel episode-complete');main.appendChild(panel);
    panel.appendChild(el('p',item.grandparentTitle||'TV series','eyebrow'));
    panel.appendChild(el('h1','Episode finished'));
    panel.appendChild(el('p',F.episodeLabel(item)+' · Choose what to watch next. Nothing plays automatically.'));
    var status=el('p','Finding the next episode…','muted');status.setAttribute('role','status');panel.appendChild(status);
    var next=btn('Play next episode',function(){
      if(busy||!nextItem||stamp!==revision||scope!==preferenceScope())return;
      busy=true;next.disabled=true;status.textContent='Checking the next episode…';
      viewRequest=api('/library/metadata/'+encodeURIComponent(nextItem.ratingKey)+'?includeChapters=1');
      viewRequest.then(function(data){
        if(stamp!==revision||scope!==preferenceScope())return;
        var fresh=C.extract(data).items[0];if(!fresh||fresh.type!=='episode'||String(fresh.ratingKey)!==String(nextItem.ratingKey))throw new Error('This episode is no longer available.');
        C.primaryPart(fresh);busy=false;next.disabled=false;play(fresh,Number(fresh.viewOffset)||0);
      }).catch(function(error){if(stamp===revision&&scope===preferenceScope()&&!error.cancelled){busy=false;next.disabled=false;status.textContent='Could not start the next episode. Try again. '+C.safeError(error);}});
    },'primary');next.disabled=true;panel.appendChild(next);
    panel.appendChild(btn('All episodes',function(){openSeriesEpisodes(item);}));
    panel.appendChild(btn('Back to library',function(){stack=[];browse(homeRoute());}));
    var retry=btn('Retry finding next episode',lookup);retry.hidden=true;panel.appendChild(retry);
    function lookup(){
      retry.hidden=true;status.textContent='Finding the next episode…';
      viewRequest=service.nextEpisode(item,api);
      viewRequest.then(function(found){
        if(stamp!==revision||scope!==preferenceScope())return;
        nextItem=found;next.hidden=!found;next.disabled=!found;
        status.textContent=found?'Next: '+F.episodeLabel(found)+'. Starts only when you choose Play next episode.':'This is the last available episode.';
      }).catch(function(error){if(stamp===revision&&scope===preferenceScope()&&!error.cancelled){status.textContent='Could not find the next episode. '+C.safeError(error);retry.hidden=false;}});
    }
    lookup();focusFirst(panel);
  }
  function stopPlayback(){
    if(playbackAttempt)playbackAttempt.cancelled=true;
    playbackEpoch++;if(playbackRequest&&playbackRequest.abort)playbackRequest.abort();playbackRequest=null;
    if(player.active)player.stop();else finishPlayback();
  }
  function isConnectionFailure(error){return /CONNECTION|Cannot reach|did not respond|timed out|HTTP (401|403|5\d\d)/i.test(C.safeError(error));}
  function playbackFailureMessage(error){var message=C.safeError(error);if(/PLAYER_ERROR_CONNECTION_FAILED/.test(message))return 'The TV lost its connection to the playback stream. Check that Plex is running, then retry.';if(/NOT_SUPPORTED/.test(message))return 'The TV could not play this stream.';if(/PLAYER_ERROR_SEEK_FAILED/.test(message))return 'The TV could not resume at the saved position.';if(/HTTP 5\d\d/.test(message))return 'Plex is currently unavailable. Check the server, then retry.';if(/PLAYER_ERROR_/.test(message))return 'Playback stopped unexpectedly. Your position has been kept.';return message;}
  function playbackRecovery(error){
    var attempt=playbackAttempt;if(!attempt)return;
    var item=attempt.item,offset=Math.max(0,Number(attempt.offset)||0),mode=attempt.mode,subtitleId=attempt.subtitleStream&&attempt.subtitleStream.id,burn=attempt.burn;
    saveRecoveryPosition(item,offset);playbackEpoch++;if(playbackRequest&&playbackRequest.abort)playbackRequest.abort();playbackRequest=null;
    if(player.active)player.stop({notify:false,report:false});cleanupTranscode();playbackAttempt=null;pendingNextItem=null;clearSubtitles();closePlaybackMenu(false);clearTimeout(controlsTimer);
    playerUI.hidden=true;shell.hidden=false;screensaver(true);loadPreferences();
    var stamp=begin();route=null;var panel=el('section',undefined,'panel');main.appendChild(panel);
    panel.appendChild(el('h1','Playback interrupted'));panel.appendChild(el('p','Your place is kept at '+C.duration(offset)+'. Retry when the server and connection are ready.'));
    var message=el('p',playbackFailureMessage(error));message.setAttribute('role','status');panel.appendChild(message);
    var retry=btn('Retry from '+C.duration(offset),function(){
      retry.disabled=true;message.textContent='Checking this title on your Plex server…';
      viewRequest=api('/library/metadata/'+encodeURIComponent(item.ratingKey)+'?includeChapters=1',{timeout:5000});
      viewRequest.then(function(data){
        if(stamp!==revision)return;var fresh=C.extract(data).items[0];if(!fresh)throw new Error('This title is no longer available.');C.primaryPart(fresh);
        play(fresh,offset,{mode:mode,subtitleId:subtitleId,burn:burn});
      }).catch(function(failure){if(stamp===revision&&!failure.cancelled){message.textContent=playbackFailureMessage(failure)+' Your saved position has been kept.';retry.disabled=false;retry.focus();}});
    },'primary');panel.appendChild(retry);
    panel.appendChild(btn('Return to library',function(){if(stack.length)back();else browse(homeRoute());}));panel.appendChild(btn('Connection settings',setup));retry.focus();
  }
  function tryPlayback(){
    var attempt=playbackAttempt;if(!attempt)return;
    if(player.active){note('Ignored duplicate playback transition');return;}
    cleanupTranscode();clearSubtitles();attempt.index++;
    contextTracks={audio:'Not reported',subtitles:'Not reported'};contextReadAt=-Infinity;
    if(attempt.index>=attempt.modes.length){
      playbackRecovery(attempt.lastError||new Error('This file could not start. Check that Plex permits conversion, then retry.'));return;
    }
    var epoch=++playbackEpoch,mode=attempt.modes[attempt.index];attempt.mode=mode;attempt.startedAt=performance.now();
    document.getElementById('playback-mode').textContent=mode==='direct'?'Original file · Direct play':mode==='remux'?'Compatibility fallback · preserving video when possible':'Compatibility fallback · converting video and audio';
    if(mode==='direct'){
      player.open(C.mediaURL(server,C.primaryPart(attempt.item).part.key,serverToken),attempt.item,attempt.offset);return;
    }
    document.getElementById('player-message').textContent='Asking Plex for a compatible stream…';
    var id=clientId+'-'+Date.now()+'-'+epoch,params=F.transcodeParams(attempt.item,mode,id,clientId);
    var source=C.primaryPart(attempt.item),audioStreams=(source.part.Stream||[]).filter(function(stream){return Number(stream.streamType)===2;});
    var preferredAudio=audioStreams.filter(function(stream){return stream.id===attempt.audioStreamId;})[0]||F.preferredTrack(audioStreams,prefs.audioLanguage,prefs.audioTraits);
    var subtitleStreams=(source.part.Stream||[]).filter(function(stream){return Number(stream.streamType)===3;});
    var desiredSubtitle=attempt.subtitleStream||F.preferredSubtitle(subtitleStreams,prefs.subtitleLanguage,prefs.subtitleTraits)||subtitleStreams.filter(function(stream){return stream.selected;})[0];
    if(prefs.subtitleMode==='off'&&!attempt.burn)desiredSubtitle=null;
    if(attempt.burn){params.subtitles='burn';params.subtitleSize=Math.round(prefs.subtitleSize/48*100);}
    attempt.session={id:id,server:server,headers:headers(true)};
    var streamSelection={};if(preferredAudio)streamSelection.audioStreamID=preferredAudio.id;
    if(desiredSubtitle)streamSelection.subtitleStreamID=desiredSubtitle.id;else if(prefs.subtitleMode==='off')streamSelection.subtitleStreamID=0;
    var selection=source.part.id&&Object.keys(streamSelection).length?api('/library/parts/'+encodeURIComponent(source.part.id)+'?'+C.query(streamSelection),{method:'PUT',noBody:true}):Promise.resolve();
    selection.then(function(){
      if(epoch!==playbackEpoch)return;
      playbackRequest=api('/video/:/transcode/universal/decision?'+C.query(params),{timeout:10000});return playbackRequest;
    }).then(function(data){
      if(epoch!==playbackEpoch||attempt!==playbackAttempt)return;
      var box=data.MediaContainer||data;
      if(Number(box.generalDecisionCode)>=2000||Number(box.transcodeDecisionCode)>=2000)throw new Error('Plex could not create this playback stream.');
      var decision=((box.Metadata||[])[0]||{}).Media||[];
      if(decision[0])note('Plex decision: video '+(decision[0].videoDecision||'unknown')+', audio '+(decision[0].audioDecision||'unknown'));
      var url=C.mediaURL(server,'/video/:/transcode/universal/start.m3u8',serverToken,params);
      player.open(url,attempt.item,attempt.offset,{timeout:30000});
    }).catch(function(error){if(epoch===playbackEpoch&&!error.cancelled){note(error);attempt.lastError=error;if(isConnectionFailure(error))playbackRecovery(error);else tryPlayback();}});
  }
  function play(item, offset, recovery) {
    if(progressWrites[accountEpoch+':'+preferenceScope()+':'+item.ratingKey]){toast('Wait for the playback progress update to finish.');return;}
    if(playbackAttempt||player.active){toast('Playback is already active. Use Stop before opening another title.');return;}
    try {
      var source = C.primaryPart(item);
      C.mediaURL(server, source.part.key, serverToken);
      if (!window.webapis || !webapis.avplay) throw new Error('Install this app on the Samsung TV to test playback. Browser previews cannot use AVPlay.');
      playerReturn = item;
      prefs=Object.assign(F.settings(basePrefs),showPreference(item)||{});applySubtitleStyle();
      playbackAttempt={item:item,offset:Number(offset||0),modes:F.playbackModes(item,prefs),index:-1,mode:null,played:false,burn:false};
      var streams=source.part.Stream||[],audioStreams=streams.filter(function(stream){return Number(stream.streamType)===2;}),subtitleStreams=streams.filter(function(stream){return Number(stream.streamType)===3;});
      var chosenAudio=F.preferredTrack(audioStreams,prefs.audioLanguage,prefs.audioTraits)||audioStreams.filter(function(stream){return stream.selected;})[0]||audioStreams[0];
      var subtitlesWanted=prefs.subtitleMode!=='off'&&!(prefs.subtitleMode==='foreign'&&prefs.audioLanguage&&chosenAudio&&F.trackLanguage(chosenAudio)===prefs.audioLanguage);
      var chosenSubtitle=subtitlesWanted&&(F.preferredSubtitle(subtitleStreams,prefs.subtitleLanguage,prefs.subtitleTraits)||subtitleStreams.filter(function(stream){return stream.selected;})[0]||(prefs.subtitleMode==='always'?subtitleStreams[0]:null));
      if(chosenSubtitle&&!chosenSubtitle.key&&prefs.playbackMode!=='direct'&&(/^(pgs|hdmv_pgs_subtitle|vobsub|dvd_subtitle|dvdsub)$/i.test(chosenSubtitle.codec||'')||playbackAttempt.modes[0]!=='direct')){
        playbackAttempt.burn=true;playbackAttempt.subtitleStream=chosenSubtitle;playbackAttempt.modes=['convert'];
      }
      if(recovery&&recovery.mode!=='direct'){
        playbackAttempt.modes=recovery.mode==='remux'?['remux','convert']:['convert'];
        var recoveredSubtitle=subtitleStreams.filter(function(stream){return stream.id===recovery.subtitleId;})[0];
        if(recovery.burn&&recoveredSubtitle){playbackAttempt.burn=true;playbackAttempt.subtitleStream=recoveredSubtitle;playbackAttempt.modes=['convert'];}
      }
      tryPlayback();
      if(!playbackAttempt)return;
      closePlaybackMenu(false);
      shell.hidden = true; playerUI.hidden = false; controls.hidden = false;
      document.getElementById('playing-title').textContent = F.hideSpoiler(item,prefs)?F.episodeLabel(item):item.title;
      document.getElementById('control-next').hidden=item.type!=='episode';
      document.getElementById('playback-time').textContent = C.duration(offset) + ' / ' + C.duration(item.duration);
      document.getElementById('progress-fill').style.width = '0%';
      showControls();
    } catch (e) { shell.hidden = false; playerUI.hidden = true; toast(C.safeError(e)); }
  }
  function cancelMenuWork(){
    menuEpoch++;if(nextRequest&&nextRequest.abort)nextRequest.abort();nextRequest=null;
    if(scrub&&scrub.image){scrub.image.onload=null;scrub.image.onerror=null;scrub.image.removeAttribute('src');}
    scrub=null;clearTimeout(previewTimer);descriptionText=null;playbackMenu.classList.remove('description-dialog');playbackMenu.classList.remove('scrub-dialog');
  }
  function backPlaybackMenu(){
    if(!menuParents.length){closePlaybackMenu(true);return;}
    var previous=menuParents.pop();cancelMenuWork();previous.render();
    var buttons=menuOptions.querySelectorAll('button');
    if(buttons[previous.index])buttons[previous.index].focus();
    menuOptions.scrollTop=previous.scroll;
  }
  function descriptionDialog(title,text){
    descriptionScroll=main.scrollTop;
    openPlaybackMenu(title,'Up / Down scrolls the description · OK or Back returns to Read more',[]);
    playbackMenu.classList.add('description-dialog');
    descriptionText=el('div',text,'description-text');descriptionText.tabIndex=0;descriptionText.setAttribute('role','region');descriptionText.setAttribute('aria-label','Full description');
    menuOptions.insertBefore(descriptionText,menuOptions.firstChild);descriptionText.focus();
  }
  function closePlaybackMenu(restoreFocus) {
    var wasDescription=!!descriptionText;cancelMenuWork();menuParents=[];menuCurrent=null;
    playbackMenu.hidden = true;
    menuOptions.textContent = '';
    if (restoreFocus) {
      if(player.active)showControls();
      if (menuReturnFocus && document.body.contains(menuReturnFocus)) menuReturnFocus.focus();
    }
    menuReturnFocus = null;if(wasDescription)main.scrollTop=descriptionScroll;updatePlaybackContext(true);
  }
  function openPlaybackMenu(title, hint, choices, rebuild) {
    menuEpoch++;descriptionText=null;playbackMenu.classList.remove('description-dialog');
    menuCurrent=rebuild||function(){openPlaybackMenu(title,hint,choices);};
    if (playbackMenu.hidden) menuReturnFocus = document.activeElement;
    clearTimeout(controlsTimer);
    controls.hidden = false;
    if(player.active)playerUI.classList.add('controls-visible');
    document.getElementById('playback-menu-title').textContent = title;
    document.getElementById('playback-menu-hint').textContent = hint;
    menuOptions.textContent = '';
    choices.forEach(function (choice) {
      var button = btn(choice.label, function () {
        try {
          if(choice.child)menuParents.push({render:menuCurrent,index:Array.prototype.indexOf.call(menuOptions.querySelectorAll('button'),button),scroll:menuOptions.scrollTop});
          choice.action();contextReadAt=-Infinity; if(!choice.keepOpen)backPlaybackMenu();
          updatePlaybackContext(true);
        }
        catch (e) { toast(C.safeError(e)); }
      });
      if (choice.selected !== undefined) button.setAttribute('aria-pressed', String(choice.selected));
      menuOptions.appendChild(button);
    });
    menuOptions.appendChild(btn(menuParents.length?'Back':'Close',backPlaybackMenu));
    playbackMenu.hidden = false;
    var selected = menuOptions.querySelector('[aria-pressed="true"]');
    if (selected) selected.focus(); else focusFirst(menuOptions);
  }
  function trackMenu(type) {
    try {
      if (!player.started || player.seeking) { toast('Wait for playback or seeking to finish, then choose a track.'); return; }
      var tracks = availableTracks(type);
      var selected = player.currentTrack(type);
      var choices = tracks.map(function (track, index) {
        return { label: C.trackLabel(track, index), selected: !externalSubtitle&&selected === track.index, action: function () {
          if(type==='TEXT')clearSubtitles();player.selectTrack(type, track.index);
          if(type==='AUDIO')prefs.audioLanguage=F.trackLanguage(track);else{prefs.subtitleLanguage=F.trackLanguage(track);prefs.subtitleMode='always';}
          saveTrackPreferences(type,track);
        } };
      });
      if(type==='AUDIO'&&playbackAttempt&&playbackAttempt.mode!=='direct'){
        var streams=(C.primaryPart(playerReturn).part.Stream||[]).filter(function(stream){return Number(stream.streamType)===2;});
        if(streams.length)choices=streams.map(function(stream){return {label:(stream.displayTitle||stream.language||F.language(stream.languageCode)||'Audio')+' · '+(stream.codec||'')+' · Plex',action:function(){restartWithAudio(stream);}};});
      }
      if(type==='TEXT'){
        plexSubtitleStreams().forEach(function(stream){
          if(!stream.key&&tracks.some(function(track){return track.plexId===stream.id;}))return;
          choices.push({label:(stream.displayTitle||stream.language||F.language(stream.languageCode)||'Subtitle')+' · '+(stream.codec||'text')+' · Plex',selected:(!!externalSubtitle&&externalSubtitle.id===stream.id)||(!!playbackAttempt&&playbackAttempt.burn&&playbackAttempt.subtitleStream&&playbackAttempt.subtitleStream.id===stream.id),action:function(){choosePlexSubtitle(stream,true);}});
        });
        choices.unshift({ label: 'Subtitles off', selected: !externalSubtitle&&!(playbackAttempt&&playbackAttempt.burn)&&selected === -1, action: function () {
          clearSubtitles();player.selectTrack('TEXT', -1);prefs.subtitleMode='off';saveTrackPreferences('TEXT');
          if(playbackAttempt&&playbackAttempt.burn)restartWithSubtitle(null);
        } });
      }
      var hint = tracks.length ? 'Up / Down to choose · OK to select · Back to close' : 'No ' + (type === 'AUDIO' ? 'audio' : 'embedded subtitle') + ' tracks reported by the TV.';
      if(showPreference(playerReturn))choices.push({label:'Reset saved show preferences',action:function(){remove(showPreferenceKey(playerReturn));toast('Saved show choices cleared. Profile defaults will apply next time.');}});
      openPlaybackMenu(type === 'AUDIO' ? 'Audio tracks' : 'Subtitles', hint, choices);
    } catch (e) { toast(C.safeError(e)); }
  }
  function availableTracks(type){var tracks=player.tracks(type);return type==='TEXT'&&playbackAttempt&&playbackAttempt.mode==='direct'?F.enrichTextTracks(tracks,C.primaryPart(playerReturn).part.Stream||[]):tracks;}
  function plexSubtitleStreams(){try{return (C.primaryPart(playerReturn).part.Stream||[]).filter(function(stream){return Number(stream.streamType)===3;});}catch(_){return [];}}
  function choosePlexSubtitle(stream,remember){
    if(playbackAttempt&&playbackAttempt.burn&&!/^(pgs|hdmv_pgs_subtitle|vobsub|dvd_subtitle|dvdsub)$/i.test(stream.codec||'')){playbackAttempt.pendingSubtitle={stream:stream,remember:remember};restartWithSubtitle(null);return;}
    if(/^(pgs|hdmv_pgs_subtitle|vobsub|dvd_subtitle|dvdsub)$/i.test(stream.codec||'')){restartWithSubtitle(stream);if(remember){prefs.subtitleMode='always';prefs.subtitleLanguage=F.trackLanguage(stream);saveTrackPreferences('TEXT',stream);}return;}
    if(!stream.key){
      var matching=availableTracks('TEXT').filter(function(track){return track.plexId===stream.id;})[0];
      if(matching){clearSubtitles();player.selectTrack('TEXT',matching.index);}
      else{
        if(prefs.playbackMode==='direct')throw new Error('This track needs Plex to render it. Choose Automatic playback or a TV track.');
        restartWithSubtitle(stream,true);
      }
      if(remember){prefs.subtitleMode='always';prefs.subtitleLanguage=F.trackLanguage(stream);saveTrackPreferences('TEXT',stream);}return;
    }
    clearSubtitles();var epoch=subtitleEpoch;
    var previousTrack=player.currentTrack('TEXT');player.selectTrack('TEXT',-1);
    var path=stream.key+(stream.key.indexOf('?')<0?'?':'&')+'format=srt&encoding=utf-8';
    C.mediaURL(server,path,'');var parser=new S.StreamParser(),activated=false;
    function receive(text,final){
      if(epoch!==subtitleEpoch||!player.active)return;
      var cues=parser.feed(text,final);if(!cues.length)return;
      subtitleCues=cues;
      if(!activated){externalSubtitle=stream;activated=true;contextReadAt=-Infinity;updatePlaybackContext(true);document.getElementById('subtitle-text').lang=F.trackLanguage(stream)||'';updateSubtitleClock();}
    }
    subtitleRequest=api(path,{format:'text',maxBytes:8*1024*1024,timeout:10000,onTextProgress:function(text){receive(text,false);}});
    subtitleRequest.then(function(text){
      if(epoch!==subtitleEpoch||!player.active)return;
      receive(text,true);if(!subtitleCues.length)throw new Error('Plex returned no readable text cues for this subtitle.');
      if(remember){prefs.subtitleMode='always';prefs.subtitleLanguage=F.trackLanguage(stream);saveTrackPreferences('TEXT',stream);}
      updateSubtitleClock();if(!remember||!showPreferenceKey(playerReturn))toast('Text subtitles loaded. Size, color and timing controls are available.');
    }).catch(function(error){if(epoch===subtitleEpoch&&!error.cancelled){if(!activated&&previousTrack>=0&&!player.seeking){try{player.selectTrack('TEXT',previousTrack);}catch(_){}}toast(C.safeError(error));}});
  }
  function restartWithAudio(stream){
    if(!playbackAttempt||player.seeking)return;
    if(playbackAttempt.switching){toast('A track change is already in progress.');return;}
    var attempt=playbackAttempt,part=C.primaryPart(attempt.item).part,epoch=playbackEpoch;
    if(!part.id)throw new Error('Plex did not provide an audio selection ID.');
    attempt.switching=true;
    api('/library/parts/'+encodeURIComponent(part.id)+'?'+C.query({audioStreamID:stream.id}),{method:'PUT',noBody:true}).then(function(){
      if(epoch!==playbackEpoch||attempt!==playbackAttempt)return;
      attempt.switching=false;if(player.seeking){toast('Wait for seeking to finish, then choose the track again.');return;}
      prefs.audioLanguage=F.trackLanguage(stream);saveTrackPreferences('AUDIO',stream);attempt.offset=player.time;attempt.audioStreamId=stream.id;
      player.stop({notify:false,report:false});attempt.modes=[attempt.mode];attempt.index=-1;tryPlayback();
    }).catch(function(error){attempt.switching=false;if(epoch===playbackEpoch)toast(C.safeError(error));});
  }
  function restartWithSubtitle(stream,forceBurn){
    if(!playbackAttempt||player.seeking)return;
    if(playbackAttempt.switching){toast('A track change is already in progress.');return;}
    var attempt=playbackAttempt,part=C.primaryPart(attempt.item).part;
    if(!part.id){toast('Plex did not provide a part ID for subtitle conversion.');return;}
    var epoch=playbackEpoch;
    attempt.switching=true;
    api('/library/parts/'+encodeURIComponent(part.id)+'?'+C.query({subtitleStreamID:stream?stream.id:0}),{method:'PUT',noBody:true}).then(function(){
      if(epoch!==playbackEpoch||attempt!==playbackAttempt)return;
      attempt.switching=false;if(player.seeking){toast('Wait for seeking to finish, then choose the track again.');return;}
      attempt.offset=player.time;player.stop({notify:false,report:false});attempt.burn=!!stream&&(forceBurn||/^(pgs|hdmv_pgs_subtitle|vobsub|dvd_subtitle|dvdsub)$/i.test(stream.codec||''));attempt.subtitleStream=stream;
      attempt.modes=attempt.burn?['convert']:stream?['remux','convert']:F.playbackModes(attempt.item,prefs);attempt.index=-1;
      toast(attempt.burn?'Plex is rendering this subtitle into the video. TV text color and timing controls do not apply.':stream?'Plex is preparing a text subtitle stream.':'Restarting without burned-in subtitles.');tryPlayback();
    }).catch(function(error){attempt.switching=false;if(epoch===playbackEpoch)toast(C.safeError(error));});
  }
  function applyTrackPreferences(){
    if(applyingPreferences||!player.started)return;applyingPreferences=true;
    try{
      if(prefs.subtitleDelay&&!(playbackAttempt&&playbackAttempt.burn)){try{player.subtitleDelay(prefs.subtitleDelay);}catch(error){note(error);}}
      if(!prefs.audioLanguage&&!prefs.subtitleLanguage&&prefs.subtitleMode==='default'&&!(playbackAttempt&&(playbackAttempt.pendingSubtitle||playbackAttempt.subtitleStream)))return;
      var audio=F.preferredTrack(player.tracks('AUDIO'),prefs.audioLanguage,prefs.audioTraits);
      if(audio)player.selectTrack('AUDIO',audio.index);
      if(playbackAttempt&&playbackAttempt.burn){player.selectTrack('TEXT',-1);return;}
      if(playbackAttempt&&playbackAttempt.pendingSubtitle){var pending=playbackAttempt.pendingSubtitle;playbackAttempt.pendingSubtitle=null;choosePlexSubtitle(pending.stream,pending.remember);return;}
      var off=prefs.subtitleMode==='off'||(prefs.subtitleMode==='foreign'&&prefs.audioLanguage&&audio);
      if(off){player.selectTrack('TEXT',-1);return;}
      var tracks=availableTracks('TEXT'),track=F.preferredTrack(tracks,prefs.subtitleLanguage,prefs.subtitleTraits),streams=plexSubtitleStreams();
      if(track){player.selectTrack('TEXT',track.index);return;}
      var textStream=F.preferredSubtitle(streams,prefs.subtitleLanguage,prefs.subtitleTraits);
      if(!textStream&&prefs.subtitleMode==='always')textStream=streams.filter(function(stream){return stream.selected;})[0]||streams[0];
      // AVPlay can report tracks before their language metadata is populated.
      // Let playback proceed while that metadata settles; do not transcode a
      // perfectly playable file just because its first track query was early.
      if(textStream&&!textStream.key&&playbackAttempt&&playbackAttempt.mode==='direct'){
        var attempt=playbackAttempt,generation=player.generation;
        if(!attempt.trackPreferenceStarted)attempt.trackPreferenceStarted=performance.now();
        if(performance.now()-attempt.trackPreferenceStarted<1500){setTimeout(function(){if(attempt===playbackAttempt&&generation===player.generation&&player.started)applyTrackPreferences();},150);return;}
      }
      if(textStream)choosePlexSubtitle(textStream,false);
      else if(prefs.subtitleMode==='always'&&tracks.length)player.selectTrack('TEXT',tracks[0].index);
    }catch(error){note(error);}finally{applyingPreferences=false;updatePlaybackContext(true);}
  }
  function timelineMenu(delta){
    if(!player.started||player.seeking){toast('Wait for playback or seeking to finish.');return;}
    openPlaybackMenu('Choose where to jump','Left / Right: 10 seconds · Up / Down: 1 minute · OK: jump · Back: cancel',[]);
    playbackMenu.classList.add('scrub-dialog');
    var slider=el('input');slider.type='range';slider.min='0';slider.max=String(Math.max(0,player.duration-1000));slider.step='1000';slider.value=String(player.time);slider.setAttribute('aria-label','Seek position');
    var label=el('p',undefined,'scrub-time'),visual=el('div',undefined,'scrub-visual'),image=el('img',undefined,'scrub-preview'),status=el('p',undefined,'scrub-status');image.alt='Frame near selected position';image.hidden=true;
    visual.appendChild(image);visual.appendChild(status);
    var commit=btn('Seek to '+C.duration(player.time),commitScrub);
    menuOptions.insertBefore(visual,menuOptions.firstChild);menuOptions.insertBefore(label,menuOptions.lastChild);menuOptions.insertBefore(slider,menuOptions.lastChild);menuOptions.insertBefore(commit,menuOptions.lastChild);
    menuOptions.lastChild.textContent='Cancel';
    scrub={time:player.time+(typeof delta==='number'?delta:0),slider:slider,label:label,image:image,visual:visual,status:status,commit:commit,unavailable:false,previewEpoch:0,lastRepeat:0};
    controls.hidden=true;
    slider.oninput=function(){if(scrub){scrub.time=Number(slider.value);updateScrub();}};slider.focus();updateScrub();
    playerUI.style.setProperty('--controls-height',(playbackMenu.querySelector('.playback-menu-panel').offsetHeight+52)+'px');
  }
  function commitScrub(){
    if(!scrub)return;
    var target=scrub.time;closePlaybackMenu(true);player.seek(target);
  }
  function updateScrub(){
    if(!scrub)return;var state=scrub;
    state.time=Math.max(0,Math.min(Math.max(0,player.duration-1000),state.time));state.slider.value=String(state.time);
    state.slider.setAttribute('aria-valuetext',C.duration(state.time)+' of '+C.duration(player.duration));
    state.label.textContent=C.duration(state.time)+' / '+C.duration(player.duration);state.commit.textContent='Seek to '+C.duration(state.time);
    clearTimeout(previewTimer);var epoch=++state.previewEpoch;
    state.image.onload=null;state.image.onerror=null;state.image.removeAttribute('src');state.image.hidden=true;state.status.hidden=false;
    if(!prefs.previewImages){state.status.textContent='Preview images are turned off in Settings.';return;}
    if(state.unavailable){state.status.textContent='Preview unavailable. You can still choose a time and press OK.';return;}
    var path=F.previewPath(playerReturn,state.time);
    if(!path){state.status.textContent='Plex has no preview images for this title. You can still choose a time and press OK.';return;}
    state.status.textContent='Loading preview…';
    previewTimer=setTimeout(function(){
      if(scrub!==state||state.previewEpoch!==epoch)return;
      var image=el('img',undefined,'scrub-preview');image.alt='Frame near '+C.duration(state.time);image.hidden=true;
      state.visual.replaceChild(image,state.image);state.image=image;
      image.onload=function(){if(scrub===state&&state.previewEpoch===epoch){image.hidden=false;state.status.hidden=true;}};
      image.onerror=function(){if(scrub===state&&state.previewEpoch===epoch){state.unavailable=true;state.status.textContent='Preview unavailable. You can still choose a time and press OK.';image.hidden=true;}};
      image.src=C.mediaURL(server,path,serverToken);
    },220);
  }
  function seekMenu(direction) {
    if (!player.started || player.seeking) { toast('Wait for playback or seeking to finish.'); return; }
    openPlaybackMenu(direction < 0 ? 'Skip backward' : 'Skip forward', 'Up / Down to choose · OK to seek · Back to close', [
      { label: '10 seconds', ms: 10000 }, { label: '1 minute', ms: 60000 }, { label: '10 minutes', ms: 600000 }
    ].map(function (step) {
      return { label: (direction < 0 ? '−' : '+') + step.label, action: function () {
        if (!player.started || player.seeking) throw new Error('Wait for the current seek to finish.');
        player.seek(player.time + direction * step.ms);
      } };
    }));
  }
  function showControls(refreshTracks) {
    if(refreshTracks)contextReadAt=-Infinity;
    updatePlaybackContext(refreshTracks||controls.hidden);
    var wasHidden = controls.hidden;
    controls.hidden = false;
    playerUI.style.setProperty('--controls-height',(controls.offsetHeight+20)+'px');
    playerUI.classList.add('controls-visible');
    if (playbackMenu.hidden && (wasHidden || !controls.contains(document.activeElement))) focusFirst(controls);
    clearTimeout(controlsTimer);
    if (playbackMenu.hidden) controlsTimer = setTimeout(function () { if (player.active && player.state === 'playing' && playbackMenu.hidden){controls.hidden = true;playerUI.classList.remove('controls-visible');} }, 7000);
  }
  function hideControls(){clearTimeout(controlsTimer);controls.hidden=true;playerUI.classList.remove('controls-visible');if(controls.contains(document.activeElement))document.activeElement.blur();}
  function confirmStopPlayback(){
    if(!player.active&&!playbackAttempt)return;
    openPlaybackMenu('Stop playback?','Keep watching, or stop and return to this title. Your position will be saved.',[
      {label:'Keep watching',selected:true,keepOpen:true,action:function(){closePlaybackMenu(false);hideControls();}},
      {label:'Stop playback',action:stopPlayback}
    ]);
  }
  function back() {
    if (!playbackMenu.hidden) { backPlaybackMenu(); return; }
    if (player.active||playbackAttempt) { if(!controls.hidden)hideControls();else confirmStopPlayback();return; }
    if (stack.length) {
      var previous = stack.pop(); restoreScreen = previous.focus ? previous : null;
      returningScreen=true;
      if (previous.screen) { previous.screen(); screenRenderer=previous.screen; }
      else if (previous.route) browse(previous.route,previous.index,undefined,previous.scrollTop);
      else setup();
      returningScreen=false;
      return;
    }
    if (!route || route.section !== 'home') { if (token && server) browse(homeRoute()); else setup(); return; }
    if (Date.now() - lastBack < 1800) { try { tizen.application.getCurrentApplication().exit(); } catch (_) { toast('Close this browser tab to exit.'); } }
    else { lastBack = Date.now(); toast('Press Back again to exit.'); }
  }
  function diagnostics() {
    begin(); route = null;
    main.appendChild(el('h1', 'Diagnostics'));
    main.appendChild(el('p', 'A photo of this screen is enough for debugging. Tokens and media URLs are excluded.', 'muted'));
    var version = 'Unavailable (desktop browser)';
    try { version = webapis.avplay.getVersion(); } catch (_) { /* Browser preview. */ }
    var pre = el('pre', 'TizenOS Plex '+APP_VERSION+' | Baseline: Tizen 5.0\nAVPlay: ' + version + '\n' + navigator.userAgent + '\n\nTimings (this session):\n'+measurements.map(function(m){return m.name+': '+m.ms+' ms';}).join('\n')+'\n\n' + (log.join('\n') || 'No events yet.'));
    pre.tabIndex = 0; main.appendChild(pre);
    main.appendChild(btn('Back', back, 'primary'));
    focusFirst();
  }
  function spatial(key) {
    var root = player.active||playbackAttempt ? controls : shell;
    var nodes = Array.prototype.slice.call(root.querySelectorAll('button:not(:disabled),input,select,#progress'))
      .filter(function (node) { if(!node.getClientRects().length)return false;if(libraryView&&main.contains(node)){var r=node.getBoundingClientRect(),viewport=main.getBoundingClientRect();return r.bottom>viewport.top&&r.top<viewport.bottom;}return true; });
    var current = document.activeElement;
    if (nodes.indexOf(current) < 0) { if (nodes[0]) nodes[0].focus(); return; }
    var box = current.getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    var best, bestScore = Infinity;
    nodes.forEach(function (node) {
      if (node === current) return;
      var r = node.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      var primary = key === 37 ? -dx : key === 39 ? dx : key === 38 ? -dy : dy;
      var secondary = key === 37 || key === 39 ? Math.abs(dy) : Math.abs(dx);
      if (primary <= 10) return;
      var score = primary + secondary * 4;
      if (score < bestScore) { bestScore = score; best = node; }
    });
    if (best) { best.focus(); if (nav.contains(best)) best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  document.addEventListener('keydown', function (event) {
    var key = event.keyCode;
    if(key===13&&event.repeat){event.preventDefault();return;}
    if(key===13&&document.activeElement.tagName==='BUTTON')pressFeedback(document.activeElement);
    if(descriptionText&&[37,38,39,40,13].indexOf(key)>=0){
      event.preventDefault();
      if(key===13){backPlaybackMenu();return;}
      descriptionText.focus();
      if(key===38||key===40)descriptionText.scrollTop+=(key===38?-1:1)*Math.max(80,descriptionText.clientHeight*0.75);
      return;
    }
    if (key === 10009 || key === 27 || (key === 8 && document.activeElement.tagName !== 'INPUT')) { event.preventDefault(); back(); return; }
    if(scrub&&[37,38,39,40,13].indexOf(key)>=0){event.preventDefault();if(key===13){if(document.activeElement.tagName==='BUTTON')document.activeElement.click();else commitScrub();}else{var now=performance.now();if(event.repeat&&now-scrub.lastRepeat<100)return;scrub.lastRepeat=now;scrub.time+=(key===37?-10000:key===39?10000:key===38?60000:-60000);updateScrub();}return;}
    if (!playbackMenu.hidden && ([37,38,39,40,9].indexOf(key) >= 0)) {
      event.preventDefault();
      var options = Array.prototype.slice.call(menuOptions.querySelectorAll('button'));
      var current = options.indexOf(document.activeElement);
      var direction = key === 38 || (key === 9 && event.shiftKey) ? -1 : key === 40 || key === 9 ? 1 : 0;
      options[Math.max(0, Math.min(options.length - 1, current + direction))].focus();
      return;
    }
    if (player.active||playbackAttempt) {
      if (key === 415 || key === 19 || key === 10252 || key === 32) {
        event.preventDefault();
        if (key === 415 && player.state === 'playing') return;
        if (key === 19 && player.state === 'paused') return;
        player.toggle(); showControls(true); return;
      }
      if (key === 413) { event.preventDefault(); confirmStopPlayback(); return; }
      if (key === 412 || key === 417) { event.preventDefault(); seekMenu(key === 417 ? 1 : -1); return; }
      if (document.activeElement.id==='progress' && [37,39,13].indexOf(key)>=0) {
        event.preventDefault();timelineMenu(key===37?-10000:key===39?10000:0);return;
      }
      if (controls.hidden && [37,38,39,40,13].indexOf(key) >= 0) {
        event.preventDefault();
        if(key===37||key===39)timelineMenu(key===37?-10000:10000);else showControls();
        return;
      }
      if ([37,38,39,40,13].indexOf(key) >= 0) showControls();
    }
    if ([37,38,39,40].indexOf(key) >= 0) {
      if (document.activeElement.tagName === 'INPUT' && (key === 37 || key === 39)) return;
      event.preventDefault();
      if (!player.active && !playbackAttempt && ((homeView && homeView.move(key)) || moveLibrary(key))) return;
      spatial(key);
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(pinTimer);
      if (player.active||playbackAttempt) stopPlayback();
    } else if (!token && server) setup();
  });
  try { ['MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaRewind','MediaFastForward'].forEach(function (key) { tizen.tvinputdevice.registerKey(key); }); } catch (_) { /* Normal in a browser. */ }
  note('App started');
  document.getElementById('control-toggle').onclick=function(){player.toggle();showControls(true);};
  document.getElementById('control-backward').onclick=function(){seekMenu(-1);};
  document.getElementById('control-forward').onclick=function(){seekMenu(1);};
  document.getElementById('control-audio').onclick=function(){trackMenu('AUDIO');};
  document.getElementById('control-subtitles').onclick=function(){trackMenu('TEXT');};
  document.getElementById('control-timeline').onclick=timelineMenu;
  document.getElementById('progress').onclick=function(){timelineMenu();};
  document.getElementById('control-more').onclick=function(){
    openPlaybackMenu('More playback options','Choose an action. Back returns to playback.',[
      {label:'Subtitle style',keepOpen:true,child:true,action:function(){subtitleSettings(true);}},
      {label:'Playback info',keepOpen:true,child:true,action:playbackInformation},
      {label:'Stop',keepOpen:true,child:true,action:confirmStopPlayback}
    ]);
  };
  document.getElementById('control-next').onclick=function(){nextEpisodeMenu(playerReturn);};

  fitInterface();window.addEventListener('resize',fitInterface);
  loadPreferences();
  window.addEventListener('appcontrol', previewControl);
  previewControl();
  window.TizenPlexMetrics={snapshot:function(){return measurements.slice();}};
  if (token && server) connect(); else setup();
}());
