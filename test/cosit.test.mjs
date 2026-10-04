import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {validateManifest} from '../scripts/sync-cosit.mjs';
const fullText = 'Íntegra fictícia para teste. '.repeat(40);
const hash = createHash('sha256').update(fullText).digest('hex');
const record = {id:'BR-COSIT-SC-1-2026', title:'SC Cosit 1/2026', sourceUrl:'https://normas.receita.fazenda.gov.br/test',
 sha256:hash, abstractSha256:'abstract-hash', textPath:'data/cosit/full/test.txt', ingestionStatus:'ready',
 collectedAt:'2026-10-04', integrity:'full', jurisdiction:'BR'};
const candidates = [{id:record.id, sha256:'abstract-hash', abstract:'Somente ementa'}];
function library(fetch, records = [record]) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/lib/cosit-retrieval.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,
 {module,exports:module.exports, fetch, AbortSignal, console, process:{env:{OPENAI_COSIT_VECTOR_STORE_ID:'vs_test'}},
 require:name=>name.includes('approved')?{records}: {records:candidates}});
 return module.exports;
}
test('somente íntegra coletada e correspondente à ementa atual é elegível',()=>{
 const api=library();
 assert.equal(api.eligibleDecisions([record],candidates).length,1);
 for(const change of [{integrity:'abstract'},{ingestionStatus:'retired'},{abstractSha256:'old'},{jurisdiction:'US'},{collectedAt:''}])
  assert.equal(api.eligibleDecisions([{...record,...change}],candidates).length,0);
});
test('pesquisa envia filtros e descarta versões antigas mesmo retornadas pelo serviço',async()=>{
 let body;
 const api=library(async(_,init)=>{body=JSON.parse(init.body);return Response.json({data:[
 {attributes:{decision_id:record.id,sha256:'old'},content:[{type:'text',text:'Texto antigo'}]},
 {attributes:{decision_id:record.id,sha256:hash},content:[{type:'text',text:'Texto válido'}]}]});});
 const result=await api.retrieveCosit('Escavadora','test-only');
 assert.equal(body.filters.filters.length,4);
 assert.equal(result.status,'retrieved'); assert.match(result.context,/Texto válido/); assert.doesNotMatch(result.context,/Texto antigo/);
 assert.equal(result.sources.length,1);
});
test('falha na pesquisa não é apresentada como ausência de decisões',async()=>{
 const result=await library(async()=>Response.json({}, {status:503})).retrieveCosit('Produto','test-only');
 assert.equal(result.status,'unavailable'); assert.equal(result.sources.length,0);
});
test('manifesto vazio não consulta corpus',async()=>{
 const result=await library(()=>{throw new Error('não deveria chamar')},[]).retrieveCosit('Produto','test-only');
 assert.equal(result.status,'not_configured');
});
test('sincronização valida origem, integridade e hash antes de upload',async()=>{
 assert.equal((await validateManifest([record],candidates,async()=>fullText)).length,1);
 assert.equal(Object.hasOwn(record,'reviewedBy'),false); // No manual review required.
 for (const change of [{sourceUrl:'https://example.com/ato'},{integrity:'abstract'},{sha256:'0'.repeat(64)}, {textPath:'../../secret.txt'}, {abstractSha256:'old'}])
  await assert.rejects(validateManifest([{...record,...change}],candidates,async()=>fullText));
 await assert.rejects(validateManifest([record,record],candidates,async()=>fullText));
});
