(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TizenSaved = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var limit = 100, own = Object.prototype.hasOwnProperty;
  function entry(value) {
    if (!value || !own.call(value, 'id') || !own.call(value, 'type')) return null;
    if (typeof value.id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value.id)) return null;
    if (value.type !== 'movie' && value.type !== 'show') return null;
    return {id:value.id, type:value.type};
  }
  function normalize(value) {
    var result = [], seen = Object.create(null);
    if (!Array.isArray(value)) return result;
    for (var i = 0; i < value.length && result.length < limit; i++) {
      var item = entry(value[i]);
      if (item && !seen[item.id]) { seen[item.id] = true; result.push(item); }
    }
    return result;
  }
  function has(value, id) { return normalize(value).some(function (item) { return item.id === id; }); }
  function add(value, item) {
    var list = normalize(value), valid = entry(item);
    if (!valid) return {list:list, error:'invalid'};
    if (has(list, valid.id)) return {list:list, changed:false};
    if (list.length >= limit) return {list:list, error:'full'};
    list.unshift(valid);
    return {list:list, changed:true};
  }
  function remove(value, id) { return normalize(value).filter(function (item) { return item.id !== id; }); }
  return {limit:limit, normalize:normalize, has:has, add:add, remove:remove};
}));
