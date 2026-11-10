import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {seedLedger,appendCollection,ledgerCatalog,validateLedger,sealLedger,loadPublishedLedger} from '../app/lib/cosit-ledger.ts';
import {prepareVectors,vectorPlan} from '../scripts/prepare-cosit-vectors.mjs';
const snapshot=JSON.parse(fs.readFileSync('data/cosit/candidates.json','utf8'));
const at='2026-11-10T12:00:00.000Z';
const row=(abstract='Assunto: Classificação de Mercadorias. Produto A',source='receita')=>({
 id:'BR-COSIT-SC-1-2026',authority:'Cosit',type:'Solução de Consulta',number:'1',decisionDate:'2026-01-02',
 sourceUrl:source==='receita'?'https://atosdecisorios.receita.fazenda.gov.br/consultaweb/index.jsf':'https://www.in.gov.br/web/dou/-/solucao-de-consulta-1-123',
 abstract,sha256:createHash('sha256').update(abstract).digest('hex'),ncm:[],integrity:'abstract',jurisdiction:'BR',
});
const seed=()=>seedLedger({records:[row()],lastSuccessfulCollectionAt:'2026-01-03T12:00:00.000Z'});
const run=(id='run1',dou='available')=>({id,at,collectorVersion:'test-only',window:{from:'2026-11-01',to:'2026-11-10'},sources:{
 receita:{status:'available',count:0,dateBasis:'decision'},dou:{status:dou,count:0,dateBasis:'publication'},
}});
const append=(ledger,r,receita=[],dou=[])=>appendCollection(ledger,{...r,sources:{receita:{...r.sources.receita,count:receita.length},dou:{...r.sources.dou,count:dou.length}}},{receita,dou});
test('captura real migra sem inventar versões de outra fonte e preserva os 82 atos',()=>{
 const ledger=validateLedger(seedLedger(snapshot));assert.equal(ledgerCatalog(ledger).records.length,82);
 assert.ok(ledger.observations.every(o=>o.record.sourceUrls.length===1));
 assert.equal(ledgerCatalog(ledger).sourceChecks.receita.lastSuccessAt,undefined);
});
test('execução vazia conserva decisões fora da janela e não presume revogação',()=>{
 const ledger=append(seed(),run());const catalog=ledgerCatalog(ledger);
 assert.equal(catalog.records.length,1);assert.equal(catalog.records[0].validity,'unverified');
 assert.equal(catalog.records[0].observedAt,'2026-01-03T12:00:00.000Z');
});
test('mesma decisão e mesmo hash não duplicam; reexecução identificada é bloqueada',()=>{
 const ledger=append(seed(),run(),[row()]);assert.equal(ledger.observations.length,1);
 assert.equal(ledger.observations[0].lastSeenAt,at);
 assert.throws(()=>append(ledger,run(),[row()]),/já registrada/);
});
test('alteração na mesma URL e conflito entre fontes conservam TODOS os textos',()=>{
 const modified=row('Assunto: Classificação de Mercadorias. Produto A retificado');
 const alternative=row('Assunto: Classificação de Mercadorias. Texto divergente do DOU','dou');
 const ledger=append(seed(),run(),[modified],[alternative]);
 assert.equal(ledger.observations.length,3);assert.equal(ledgerCatalog(ledger).records[0].abstract,modified.abstract);
 assert.equal(ledgerCatalog(ledger).records[0].conflictingSources,true);
 assert.ok(ledger.observations.some(o=>o.record.abstract===row().abstract));
});
test('falha de uma fonte não renova seu último sucesso nem apaga registros',()=>{
 let ledger=append(seed(),run(),[],[row(undefined,'dou')]);
 ledger=append(ledger,{...run('run2','unavailable'),at:'2026-11-11T12:00:00.000Z'});
 const checks=ledgerCatalog(ledger).sourceChecks;
 assert.equal(checks.dou.lastSuccessAt,at);assert.equal(checks.dou.status,'unavailable');
 assert.equal(checks.receita.lastSuccessAt,'2026-11-11T12:00:00.000Z');
});
test('falha dupla conserva textos e registra indisponibilidade sem sucesso fictício',()=>{
 const r=run();r.sources.receita.status='unavailable';r.sources.dou.status='unavailable';
 const catalog=ledgerCatalog(append(seed(),r));assert.equal(catalog.records.length,1);
 assert.equal(catalog.lastSuccessfulCollectionAt,'2026-01-03T12:00:00.000Z');
 assert.equal(catalog.sourceStatus.receita,'unavailable');
});
test('catálogo adulterado e fonte não oficial são rejeitados antes de consumo',async()=>{
 const ledger=seed();ledger.observations[0].record.abstract='adulterado';assert.throws(()=>validateLedger(ledger));
 const {revision,...payload}=seed();payload.observations[0].record.sourceUrl='https://example.com/falso';
 assert.throws(()=>validateLedger(sealLedger(payload)),/oficial/);
 await assert.rejects(loadPublishedLedger(async()=>Response.json({invalid:true})));
 await assert.rejects(loadPublishedLedger(async()=>new Response('',{status:503})));
});
test('vetores públicos são incrementais, verificam dimensões e não processam consultas',async()=>{
 let count=0;const ledger=await prepareVectors(seed(),async body=>{count+=body.input.length;
 assert.equal(body.model,'text-embedding-3-small');assert.equal(body.dimensions,512);
 return {data:body.input.map((_,index)=>({index,embedding:Array(512).fill(0.1)}))};});
 assert.equal(count,1);assert.equal(vectorPlan(ledger).length,0);
 await prepareVectors(ledger,()=>{throw Error('não deve chamar');});
 await assert.rejects(prepareVectors(seed(),async()=>({data:[{index:0,embedding:[1]}]})));
});
function catalogLibrary(env,ledger,fail=false) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/lib/cosit-catalog.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,
 {module,exports:module.exports,process:{env},Intl,Date,Promise,require:name=>name==='next/cache'?{unstable_cache:fn=>fn}:name.includes('candidates')?snapshot:name.includes('cosit-ledger')?{
 ledgerCatalog,loadPublishedLedger:async()=>{if(fail)throw Error('offline');return ledger;},
 }:{collectReceita:()=>{throw Error('fonte ao vivo não deve ser chamada neste teste');},collectDou:()=>{throw Error('idem');}}});
 return module.exports;
}
test('modo permanente lê acervo cumulativo sem coleta ao vivo e expõe revisão; falha usa data real do seed',async()=>{
 const ledger=append(seed(),run());const api=catalogLibrary({COSIT_PERSISTENT_CATALOG:'1'},ledger);
 const catalog=await api.getCositCatalog();assert.equal(catalog.revision,ledger.revision);assert.equal(catalog.records.length,1);
 assert.equal(api.catalogMetadata(catalog).historicalCoverage,'partial');
 const fallback=await catalogLibrary({COSIT_PERSISTENT_CATALOG:'1'},ledger,true).getCositCatalog();
 assert.equal(fallback.lastSuccessfulCollectionAt,snapshot.lastSuccessfulCollectionAt);
 assert.equal(fallback.persistenceStatus,'unavailable');assert.equal(fallback.records.length,82);
});

test('reconciliação antiga não substitui a janela recente verificada',()=>{
 let ledger=append(seed(),run());
 const old={...run('old-history'),at:'2026-11-11T12:00:00.000Z',window:{from:'2020-01-01',to:'2020-01-14'}};
 ledger=append(ledger,old);
 assert.equal(ledgerCatalog(ledger).sourceChecks.receita.window.to,'2026-11-10');
 assert.equal(ledgerCatalog(ledger).sourceChecks.receita.lastSuccessAt,at);
});

test('versão do catálogo acompanha os relatórios PDF/Word em sua seção compartilhada',async()=>{
 const {classificationReportSections}=await import('../app/lib/classification-report.ts');
 const report={result:{justificativa:'Teste',confianca:0,ncm:'',classificacao:'Pendente',descricaoAduaneira:'',informacoesPendentes:'Conferir'},
 description:'Teste',filenames:[],analyst:'Teste',analyzedAt:at,retrievedSources:['Ementa SHA-256: document-hash'],
 cositMetadata:{catalogRevision:'catalog-hash',collectedAt:at}};
 const trace=classificationReportSections(report).find(section=>section.title.includes('Rastreabilidade')).content.join('\n');
 assert.match(trace,/catalog-hash/);assert.match(trace,/document-hash/);assert.match(trace,/vigência não verificada/);
});
