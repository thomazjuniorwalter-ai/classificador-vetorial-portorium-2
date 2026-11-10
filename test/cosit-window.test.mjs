import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionWindow} from '../app/lib/cosit-window.ts';
test('janela diária, reconciliação e datas inválidas',()=>{
 assert.deepEqual(collectionWindow('2026-11-10'),{from:'2026-09-11',to:'2026-11-10'});
 assert.deepEqual(collectionWindow('2026-11-10',{from:'2020-01-01',to:'2020-12-31'}),{from:'2020-01-01',to:'2020-12-31'});
 for(const args of [{from:'2026-02-30'},{from:'2027-01-01'},{from:'2010-01-01'},{reconcile:true}])assert.throws(()=>collectionWindow('2026-11-10',args));
});
test('reconciliação semanal roda os anos configurados sem presumir cobertura completa',()=>{
 const years=new Set();
 for(let i=0;i<5;i++) {
  const today=new Date(Date.parse('2026-10-01')+i*7*86400000).toISOString().slice(0,10);
  const window=collectionWindow(today,{reconcile:true,startYear:'2022'});
  years.add(window.from.slice(0,4));assert.ok(window.to<=today);
 }
 assert.equal(years.size,5);
});
