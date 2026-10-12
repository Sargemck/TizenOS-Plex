(function (root) {
  'use strict';
  var languages = [['', 'Use file / Plex default'], ['en','English'], ['ja','Japanese / 日本語'], ['tr','Turkish / Türkçe'], ['fr','French'], ['de','German'], ['es','Spanish'], ['it','Italian'], ['pt','Portuguese'], ['ko','Korean / 한국어'], ['zh','Chinese / 中文'], ['ar','Arabic'], ['ru','Russian']];
  function language(value) {
    var code = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    if(code==='un'||code==='und'||code==='unknown')return '';
    return ({eng:'en',jpn:'ja',tur:'tr',fra:'fr',fre:'fr',deu:'de',ger:'de',spa:'es',ita:'it',por:'pt',kor:'ko',zho:'zh',chi:'zh',ara:'ar',rus:'ru',bul:'bg',bu:'bg',ces:'cs',cze:'cs',dan:'da',nld:'nl',dut:'nl',est:'et',fin:'fi',ell:'el',gre:'el',heb:'he',hun:'hu',ind:'id',lav:'lv',lit:'lt',nor:'no',pol:'pl',slk:'sk',slo:'sk',swe:'sv',tha:'th',ukr:'uk'})[code] || code;
  }
  function bounded(value, min, max, fallback) { value = Number(value); return isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function settings(value) {
    value = value || {};
    function choice(key, values, fallback) { return values.indexOf(value[key]) >= 0 ? value[key] : fallback; }
    return {
      audioLanguage: language(value.audioLanguage), subtitleLanguage: language(value.subtitleLanguage),
      subtitleMode: choice('subtitleMode',['default','always','foreign','off'],'default'),
      playbackMode: choice('playbackMode',['auto','direct','convert'],'auto'),
      subtitleSize: bounded(value.subtitleSize === undefined ? 48 : value.subtitleSize,28,96,48),
      subtitleColor: choice('subtitleColor',['white','yellow'],'white'),
      subtitleBackground: choice('subtitleBackground',['box','solid','shadow'],'box'),
      subtitlePosition: choice('subtitlePosition',['bottom','top'],'bottom'),
      subtitleDelay: bounded(value.subtitleDelay || 0,-10000,10000,0),
      subtitleWeight: choice('subtitleWeight',['normal','bold'],'bold'),
      largeUI: value.largeUI === true, previewImages: value.previewImages !== false, spoilerFree:value.spoilerFree!==false
    };
  }
  function trackLanguage(track) {
    var info = {};
    try { info = JSON.parse(track.extra_info || '{}') || {}; } catch (_) { /* Optional metadata. */ }
    var code=track.languageCode || track.languageTag || info.language || info.track_lang;
    // Some AVPlay 4.1 builds use the non-standard Japanese abbreviation "jp".
    return String(code||'').trim().toLowerCase()==='jp'?'ja':language(code);
  }
  function preferredTrack(tracks, wanted, traits) {
    wanted = language(wanted);
    if (!wanted) return null;
    if(traits){var exact=tracks.filter(function(track){return trackLanguage(track)===wanted&&['hearingImpaired','forced','commentary'].every(function(key){return !!track[key]===!!traits[key];});});if(exact.length)return exact[0];}
    for (var i=0;i<tracks.length;i++) if (trackLanguage(tracks[i]) === wanted && !tracks[i].hearingImpaired && !tracks[i].commentary && !tracks[i].forced) return tracks[i];
    for (var j=0;j<tracks.length;j++) if (trackLanguage(tracks[j]) === wanted) return tracks[j];
    return null;
  }
  function trackTraits(track){return {hearingImpaired:!!track.hearingImpaired,forced:!!track.forced,commentary:!!track.commentary};}
  function preferredSubtitle(streams,wanted,traits){
    var selected=preferredTrack(streams,wanted,traits);if(!selected)return null;
    // Keep accessibility/forced choices, but avoid burning an image track when
    // equivalent text exists in the requested language. Explicit menu picks bypass this.
    var text=streams.filter(function(stream){return trackLanguage(stream)===trackLanguage(selected)&&/^(srt|subrip|ass|ssa|webvtt|text|mov_text)$/i.test(stream.codec||'')&&['hearingImpaired','forced','commentary'].every(function(key){return !!stream[key]===!!selected[key];});});
    return text[0]||selected;
  }
  function showPreferences(value){value=value||{};var normalized=settings(value),out={audioLanguage:normalized.audioLanguage,subtitleLanguage:normalized.subtitleLanguage,subtitleMode:normalized.subtitleMode};if(value.audioTraits)out.audioTraits=trackTraits(value.audioTraits);if(value.subtitleTraits)out.subtitleTraits=trackTraits(value.subtitleTraits);return out;}
  function hideSpoiler(item,prefs){return prefs.spoilerFree&&item.type==='episode'&&!(Number(item.viewCount)>0);}
  function episodeLabel(item){return 'S'+(item.parentIndex===undefined?'?':item.parentIndex)+' · E'+(item.index===undefined?'?':item.index);}
  function enrichTextTracks(tracks,streams){
    var text=(streams||[]).filter(function(stream){return Number(stream.streamType)===3&&!stream.key&&/^(srt|subrip|ass|ssa|webvtt|text|mov_text)$/i.test(stream.codec||'');}).sort(function(a,b){return Number(a.index)-Number(b.index);});
    if(!text.length||tracks.length>text.length)return tracks;
    var known=0,consistent=true;
    tracks.forEach(function(track,index){var reported=trackLanguage(track);if(reported){known++;var code=String(text[index].languageCode||'').toLowerCase();if(reported!==trackLanguage(text[index])&&!(code.length===3&&reported===code.slice(0,2)))consistent=false;}});
    var homogeneous=text.every(function(stream){return stream.codec===text[0].codec;});
    // Old AVPlay can truncate a homogeneous subtitle list and report "un" for
    // languages. Only use the ordered prefix when multiple language anchors agree.
    if(!consistent||(tracks.length!==text.length&&!(homogeneous&&known>=3))){
      // The observed "jp" abbreviation is unambiguous. Other truncated codes
      // can collide (Estonian "es" looks like Spanish), so do not map them here.
      return tracks.map(function(track){
        var info={};try{info=JSON.parse(track.extra_info||'{}')||{};}catch(_){}
        if(String(info.track_lang||'').trim().toLowerCase()!=='jp')return track;
        var lang=trackLanguage(track),matches=text.filter(function(stream){return lang&&trackLanguage(stream)===lang;});
        if(matches.length!==1||tracks.filter(function(other){return trackLanguage(other)===lang;}).length!==1)return track;
        var stream=matches[0],copy=Object.assign({},track);copy.languageCode=stream.languageCode;copy.displayTitle=stream.displayTitle;copy.plexId=stream.id;copy.hearingImpaired=stream.hearingImpaired;copy.forced=stream.forced;
        copy.extra_info=JSON.stringify({track_lang:language(stream.languageCode),fourCC:stream.codec});
        return copy;
      });
    }
    return tracks.map(function(track,index){
      var stream=text[index],copy=Object.assign({},track);copy.languageCode=stream.languageCode;copy.displayTitle=stream.displayTitle;copy.plexId=stream.id;copy.hearingImpaired=stream.hearingImpaired;copy.forced=stream.forced;
      copy.extra_info=JSON.stringify({track_lang:language(stream.languageCode),fourCC:stream.codec});return copy;
    });
  }
  function libraryPath(section, filters) {
    filters = libraryFilters(filters);
    var values = {sort: ['titleSort:asc','addedAt:desc','year:desc','rating:desc'].indexOf(filters.sort) >= 0 ? filters.sort : 'titleSort:asc'};
    if (filters.title) values.title = String(filters.title).trim().slice(0,100);
    if (filters.unwatched) values.unwatched = 1;
    if (filters.genre) values.genre = String(filters.genre);
    if (filters.year) values.year = String(filters.year);
    return '/library/sections/' + encodeURIComponent(section) + '/all?' + Object.keys(values).map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(values[key]); }).join('&');
  }
  function own(value,key){return value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key)?value[key]:undefined;}
  // Limit Unicode code points without splitting supplementary characters. This
  // intentionally uses ES5 syntax for the first supported TV browser.
  function textLimit(value,limit){
    if(typeof value!=='string')return '';
    var points=value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]/g)||[];
    return points.slice(0,limit).join('');
  }
  function filterId(value,limit){return textLimit(typeof value==='number'&&isFinite(value)?String(value):value,limit);}
  function libraryFilters(value){
    var sort=own(value,'sort'),genre=filterId(own(value,'genre'),100),year=filterId(own(value,'year'),20);
    return {title:textLimit(own(value,'title'),100),sort:['titleSort:asc','addedAt:desc','year:desc','rating:desc'].indexOf(sort)>=0?sort:'titleSort:asc',unwatched:own(value,'unwatched')===true,genre:genre,year:year,
      genreLabel:genre?textLimit(own(value,'genreLabel'),100):'',yearLabel:year?textLimit(own(value,'yearLabel'),100):''};
  }
  function hasLibraryFilters(value){value=libraryFilters(value);return !!(value.title||value.unwatched||value.genre||value.year||value.sort!=='titleSort:asc');}
  function filterSummary(value,labels){
    var filters=libraryFilters(value),parts=[];
    function label(kind){return textLimit(own(own(labels,kind),filters[kind]),100)||filters[kind+'Label'];}
    if(filters.title)parts.push('Title: '+filters.title);
    if(filters.unwatched)parts.push('Unwatched');
    if(filters.genre)parts.push(label('genre')||'Genre selected');
    if(filters.year)parts.push(label('year')||(/^\d{4}$/.test(filters.year)?filters.year:'Year selected'));
    parts.push({'titleSort:asc':'Title A–Z','addedAt:desc':'Recently added','year:desc':'Newest release','rating:desc':'Highest rated'}[filters.sort]);
    return parts.join(' · ');
  }
  // Histories contain submitted title strings only. Storage and profile/server
  // scoping belong to the caller; merely rendering or focusing a history does
  // not modify it. Processing is bounded even for malformed saved data.
  function recentSearches(value){
    if(!Array.isArray(value))return [];
    var out=[],keys=[];
    for(var i=0;i<Math.min(value.length,100)&&out.length<5;i++){
      var title=textLimit(value[i],100),key=title.toLowerCase();
      if(title&&keys.indexOf(key)<0){out.push(title);keys.push(key);}
    }
    return out;
  }
  function addRecentSearch(value,title){
    title=textLimit(title,100);
    return recentSearches(title?[title].concat(recentSearches(value)):value);
  }
  function cardWatchState(item){
    var count=Number(own(item,'viewCount')),duration=Number(own(item,'duration')),position=Number(own(item,'viewOffset'));
    var watched=isFinite(count)&&count>0;
    if(own(item,'type')==='show'||own(item,'type')==='season'){
      var episodeCount=function(key){
        var value=own(item,key);
        if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value.trim())))return null;
        value=Number(value);
        return isFinite(value)&&value>=0&&Math.floor(value)===value?value:null;
      };
      var total=episodeCount('leafCount'),viewed=episodeCount('viewedLeafCount');
      // Plex reports aggregate episode counts for shows/seasons. They establish
      // completion only; they cannot provide a playback time or remaining time.
      if(total!==null&&total>0&&viewed!==null&&viewed>=total)watched=true;
    }
    duration=isFinite(duration)&&duration>0?duration:0;
    position=isFinite(position)&&position>0?position:0;
    if(duration)position=Math.min(position,duration);
    var inProgress=position>0&&(!duration||position<duration);
    // A rewatch may have both viewCount and viewOffset. Its current progress is
    // more useful than a checkmark; preserve watched for callers needing both.
    return {watched:watched,inProgress:inProgress,showWatched:watched&&!inProgress,position:position,duration:duration,
      progress:inProgress&&duration?position/duration:null,remaining:inProgress&&duration?duration-position:null};
  }
  function transcodeParams(item, mode, session, clientId) {
    var media=(item.Media||[])[0]||{},preserve=mode==='remux';
    return {path:'/library/metadata/' + item.ratingKey,mediaIndex:0,partIndex:0,protocol:'hls',offset:0,fastSeek:1,
      session:session,directPlay:0,directStream:mode === 'remux' ? 1 : 0,directStreamAudio:0,
      videoResolution:preserve?(media.width&&media.height?media.width+'x'+media.height:'3840x2160'):'1920x1080',maxVideoBitrate:preserve?Math.max(100000,Number(media.bitrate)||0):20000,videoBitrate:preserve?Math.max(100000,Number(media.bitrate)||0):20000,videoQuality:100,audioChannelCount:2,
      subtitles:'none',advancedSubtitles:'text',location:'lan',hasMDE:1,
      'X-Plex-Client-Identifier':clientId,'X-Plex-Session-Identifier':session,'X-Plex-Client-Profile-Name':'Generic',
      'X-Plex-Client-Profile-Extra':'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec='+(preserve?'h264,hevc':'h264')+'&audioCodec=aac&replace=true)'};
  }
  function playbackModes(item, prefs) {
    if (prefs.playbackMode === 'direct') return ['direct'];
    if (prefs.playbackMode === 'convert') return ['convert'];
    var media=(item.Media||[])[0]||{},part=(media.Part||[])[0]||{};
    var tracks=(part.Stream||[]).filter(function(stream){return Number(stream.streamType)===2;});
    var wanted=tracks.filter(function(stream){return prefs.audioLanguage&&trackLanguage(stream)===language(prefs.audioLanguage);});
    if(wanted.length)tracks=wanted;
    function unsupported(codec){return /^(dca(?:-.*)?|dts(?:-.*)?|truehd)$/.test(String(codec||'').toLowerCase());}
    var incompatible=tracks.length?tracks.every(function(stream){return unsupported(stream.codec);}):unsupported(media.audioCodec);
    return incompatible?['remux','convert']:['direct','remux','convert'];
  }
  function previewPath(item, time) {
    var media = (item.Media || [])[0], part = media && (media.Part || [])[0];
    if (!part || !part.id || !part.indexes || String(part.indexes).split(',').indexOf('sd') < 0) return '';
    return '/library/parts/' + encodeURIComponent(part.id) + '/indexes/sd/' + Math.max(0,Math.floor(time / 1000) * 1000);
  }
  var api = {languages:languages,language:language,settings:settings,trackLanguage:trackLanguage,preferredTrack:preferredTrack,preferredSubtitle:preferredSubtitle,trackTraits:trackTraits,showPreferences:showPreferences,hideSpoiler:hideSpoiler,episodeLabel:episodeLabel,enrichTextTracks:enrichTextTracks,libraryPath:libraryPath,libraryFilters:libraryFilters,hasLibraryFilters:hasLibraryFilters,filterSummary:filterSummary,recentSearches:recentSearches,addRecentSearch:addRecentSearch,cardWatchState:cardWatchState,transcodeParams:transcodeParams,playbackModes:playbackModes,previewPath:previewPath};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TizenFeatures = api;
}(this));
