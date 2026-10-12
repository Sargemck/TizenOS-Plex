(function (root) {
  'use strict';
  function clean(text) {
    return String(text || '').replace(/\{[^}]*\}/g,'').replace(/<[^>]*>/g,'').replace(/\\[Nn]/g,'\n')
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim();
  }
  function timestamp(value) {
    var pieces = String(value).replace(',','.').split(':');
    if (pieces.length < 2 || pieces.length > 3) return NaN;
    var seconds=0;
    for (var i=0;i<pieces.length;i++) { if (!/^\d+(\.\d+)?$/.test(pieces[i])) return NaN; seconds = seconds * 60 + Number(pieces[i]); }
    return Math.round(seconds * 1000);
  }
  function parse(text) {
    if (text.length > 8 * 1024 * 1024) throw new Error('Subtitle file is too large for this TV.');
    var cues=[];
    String(text).replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/).forEach(function (block) {
      var lines=block.split('\n'), at=-1;
      for(var i=0;i<Math.min(lines.length,3);i++) if(lines[i].indexOf('-->')>=0) { at=i; break; }
      if(at<0) return;
      var match=lines[at].match(/(\d{1,3}:\d{2}(?::\d{2})?[.,]\d+)\s*-->\s*(\d{1,3}:\d{2}(?::\d{2})?[.,]\d+)/);
      if(!match) return;
      var start=timestamp(match[1]),end=timestamp(match[2]),content=clean(lines.slice(at+1).join('\n'));
      if(isFinite(start) && end>start && content) cues.push({start:start,end:Math.min(end,start+600000),text:content.slice(0,4000)});
    });
    if(cues.length>30000) throw new Error('Subtitle file has too many cues for this TV.');
    cues.sort(function(a,b){return a.start-b.start;});
    var max=0;cues.forEach(function(cue){max=Math.max(max,cue.end);cue.maxEnd=max;});
    return cues;
  }
  function at(cues,time) {
    var low=0,high=cues.length;
    while(low<high){var mid=(low+high)>>1;if(cues[mid].start<=time)low=mid+1;else high=mid;}
    var found=[],steps=0;
    for(var i=low-1;i>=0 && cues[i].maxEnd>time && steps<500;i--,steps++) {
      if(cues[i].end>time)found.unshift(cues[i].text);
      if(found.length>=16)break;
    }
    return found.join('\n');
  }
  function StreamParser(){this.length=0;this.pending='';this.cues=[];}
  StreamParser.prototype.feed=function(text,final){
    if(text.length>8*1024*1024)throw new Error('Subtitle file is too large for this TV.');
    this.pending+=text.slice(this.length).replace(/\r/g,'');this.length=text.length;
    var boundary=final?this.pending.length:this.pending.lastIndexOf('\n\n');if(boundary<0)return this.cues;
    var chunk=this.pending.slice(0,boundary);this.pending=this.pending.slice(boundary+(final?0:2));
    var added=parse(chunk),cues=this.cues,oldLength=cues.length,outOfOrder=added.length&&oldLength&&added[0].start<cues[oldLength-1].start;
    added.forEach(function(cue){cues.push(cue);});
    if(cues.length>30000)throw new Error('Subtitle file has too many cues for this TV.');
    if(added.length){if(outOfOrder)cues.sort(function(a,b){return a.start-b.start;});var from=outOfOrder?0:oldLength,max=from?cues[from-1].maxEnd:0;for(var i=from;i<cues.length;i++){max=Math.max(max,cues[i].end);cues[i].maxEnd=max;}}
    return cues;
  };
  var api={clean:clean,timestamp:timestamp,parse:parse,at:at,StreamParser:StreamParser};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.TizenSubtitles=api;
}(this));
