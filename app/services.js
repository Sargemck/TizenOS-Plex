(function(root){
  'use strict';
  function Service(core, headers) { this.core=core;this.headers=headers; }
  Service.prototype.cloud=function(path,token,options){
    options=options||{};options.headers=Object.assign({},this.headers(),{'X-Plex-Token':token},options.headers||{});
    options.timeout=options.timeout||8000;
    return this.core.request('https://plex.tv'+path,options);
  };
  Service.prototype.resources=function(token){
    return this.cloud('/api/v2/resources?includeHttps=1&includeRelay=0',token).then(function(data){
      if(!Array.isArray(data))throw new Error('Plex returned an unexpected server list.');
      return data.filter(function(item){return String(item.provides||'').split(',').indexOf('server')>=0 && item.accessToken;});
    });
  };
  Service.prototype.connectResource=function(resource){
    var self=this,core=this.core,connections=[],requests=[],next=0,pending=0,settled=false;
    (resource.connections||[]).forEach(function(connection){
      if(!(connection.local===true||connection.local===1||connection.local==='1') || connection.relay===true||connection.relay===1||connection.relay==='1')return;
      try { var origin=core.normalizeServer(connection.uri);if(connections.indexOf(origin)<0)connections.push(origin); } catch(_){ /* Never attach credentials to an invalid URI. */ }
    });
    connections.sort(function(a,b){return (a.indexOf('https:')===0?0:1)-(b.indexOf('https:')===0?0:1);});
    connections=connections.slice(0,8);
    return new Promise(function(resolve,reject){
      function failed(){pending--;pump();}
      function pump(){
        if(settled)return;
        if(!pending && next>=connections.length){settled=true;reject(new Error('No local connection to this Plex server responded. Keep it awake and check its network settings.'));return;}
        while(pending<3 && next<connections.length){
          (function(origin){
            pending++;
            var probe=core.request(origin+'/identity',{timeout:1800});requests.push(probe);
            probe.then(function(data){
              if(settled)return;
              var identity=data.MediaContainer||data;
              if(identity.machineIdentifier!==resource.clientIdentifier)throw new Error('The server identity did not match.');
              var request=core.request(origin+'/library/sections',{timeout:3500,headers:Object.assign({},self.headers(),{'X-Plex-Token':resource.accessToken})});
              requests.push(request);return request;
            }).then(function(data){
              if(settled||!data)return;
              settled=true;requests.forEach(function(request){if(request.abort)request.abort();});
              resolve({server:origin,serverToken:resource.accessToken,machineId:resource.clientIdentifier,name:resource.name||'Plex server',sections:data});
            }).catch(failed);
          }(connections[next++]));
        }
      }
      pump();
    });
  };
  function xml(text){var doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('Plex returned an invalid profile response.');return doc;}
  // Resolve one show's recommendation only when its landing screen is opened.
  // Plex's OnDeck takes precedence; fallback pages stay scoped to this show.
  Service.prototype.continueSeries=function(show,request){
    var cancelled=false,current,start=0;
    function check(){if(cancelled){var error=new Error('Request cancelled.');error.cancelled=true;throw error;}}
    function valid(item){return item&&item.type==='episode'&&item.ratingKey&&String(item.grandparentRatingKey)===String(show.ratingKey);}
    var promise=Promise.resolve().then(function(){
      check();var deck=show.OnDeck,items=deck&&(deck.Metadata||deck.Video)||[];
      if(!Array.isArray(items))items=[items];
      var recommended=items.filter(valid)[0];if(recommended)return recommended;
      function page(){
        check();current=request('/library/metadata/'+encodeURIComponent(show.ratingKey)+'/allLeaves?unwatched=1&sort=parentIndex,index&X-Plex-Container-Start='+start+'&X-Plex-Container-Size=24');
        return current.then(function(data){
          check();var box=data.MediaContainer||data,list=box.Metadata||[];
          var next=list.filter(function(item){return valid(item)&&(!Number(item.viewCount)||Number(item.viewOffset)>0);})[0];
          if(next)return next;
          start+=list.length;
          if(list.length===24&&(box.totalSize===undefined||start<Number(box.totalSize))){
            if(start>=240)throw new Error('Choose an episode from Seasons & episodes. Plex did not provide a current recommendation.');
            return page();
          }
          return null;
        });
      }
      return page();
    });
    promise.abort=function(){cancelled=true;if(current&&current.abort)current.abort();};return promise;
  };
  Service.prototype.nextEpisode=function(item,request){
    var cancelled=false,current;
    function check(){if(cancelled){var error=new Error('Request cancelled.');error.cancelled=true;throw error;}}
    function after(parent,id,type){
      var start=0,found=id===null;
      function page(){
        check();current=request('/library/metadata/'+encodeURIComponent(parent)+'/children?X-Plex-Container-Start='+start+'&X-Plex-Container-Size=100');
        return current.then(function(data){
          check();var box=data.MediaContainer||data,items=box.Metadata||box.Directory||[];
          for(var i=0;i<items.length;i++){var entry=items[i];if(entry.type!==type)continue;if(found)return {found:true,item:entry};if(String(entry.ratingKey)===String(id))found=true;}
          start+=items.length;
          if(items.length===100&&(box.totalSize===undefined||start<Number(box.totalSize))){if(start>=10000)throw new Error('This season is too large to find the next episode automatically. Browse its episodes instead.');return page();}
          return {found:found,item:null};
        });
      }
      return page();
    }
    var promise=Promise.resolve().then(function(){
      if(item.type!=='episode'||!item.parentRatingKey||!item.grandparentRatingKey)throw new Error('Plex did not provide this episode’s season information. Open the season to choose an episode.');
      return after(item.parentRatingKey,item.ratingKey,'episode');
    }).then(function(result){
      if(!result.found)throw new Error('This episode was not found in its season. Refresh the library.');
      if(result.item)return result.item;
      function nextSeason(id,visited){
        if(visited>=20)throw new Error('No playable episode found in the following seasons. Browse the show to choose one.');
        return after(item.grandparentRatingKey,id,'season').then(function(season){
          if(!season.found)throw new Error('This season was not found in its show. Refresh the library.');
          if(!season.item)return null;
          return after(season.item.ratingKey,null,'episode').then(function(episode){return episode.item||nextSeason(season.item.ratingKey,visited+1);});
        });
      }
      return nextSeason(item.parentRatingKey,0);
    });
    promise.abort=function(){cancelled=true;if(current&&current.abort)current.abort();};return promise;
  };
  Service.prototype.users=function(token){
    return this.cloud('/api/home/users',token,{format:'text',maxBytes:512000}).then(function(text){
      var doc=xml(text);
      return Array.prototype.map.call(doc.querySelectorAll('User'),function(user){return {id:user.getAttribute('id'),title:user.getAttribute('title')||user.getAttribute('username')||'Plex user',protected:user.getAttribute('protected')==='1',restricted:user.getAttribute('restricted')==='1'};});
    });
  };
  Service.prototype.switchUser=function(accountToken,id,pin){
    return this.cloud('/api/home/users/'+encodeURIComponent(id)+'/switch',accountToken,{method:'POST',format:'text',maxBytes:512000,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:this.core.query({pin:pin||''})}).then(function(text){
        var user=xml(text).documentElement,token=user.getAttribute('authenticationToken')||user.getAttribute('authToken');
        if(!token)throw new Error('Plex did not authorize this profile. Check its PIN and try again.');
        return token;
      });
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=Service;else root.TizenService=Service;
}(this));
