'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../app/saved');
test('saved list accepts only own numeric identifiers and movie/show types, without metadata or secrets', () => {
  assert.deepEqual(S.normalize([{id:'1',type:'movie',token:'FIXTURE',title:'Discard'}, {id:'1',type:'show'},
    {id:'2',type:'show'}, {id:'/library/1',type:'movie'}, {id:3,type:'movie'}, {id:'4',type:'episode'},
    Object.create({id:'5',type:'movie'}), null]), [{id:'1',type:'movie'},{id:'2',type:'show'}]);
  assert.deepEqual(S.normalize({id:'1',type:'movie'}), []);
});
test('saved list insertion is newest first, deduplicated, nonmutating and never evicts at capacity', () => {
  const original = [{id:'1',type:'movie'}];
  assert.deepEqual(S.add(original,{id:'2',type:'show'}).list,[{id:'2',type:'show'}, ...original]);
  assert.equal(original.length,1);
  assert.equal(S.add(original,{id:'1',type:'movie'}).changed,false);
  const full=Array.from({length:100},(_,i)=>({id:String(i+1),type:'movie'}));
  assert.deepEqual(S.add(full,{id:'101',type:'show'}),{list:full,error:'full'});
  assert.equal(S.remove(full,'50').length,99);
  assert.equal(S.has(full,'50'),true);
});
