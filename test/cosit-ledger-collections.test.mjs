import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {seedLedger,appendCollection,ledgerCatalog,sealLedger} from '../app/lib/cosit-ledger.ts';

const at='2026-11-10T12:00:00.000Z';
const seedAt='2026-01-03T12:00:00.000Z';
const row=()=>{
 const abstract='Assunto: Classificação de Mercadorias. Produto A';
 return {id:'BR-COSIT-SC-1-2026',authority:'Cosit',type:'Solução de Consulta',number:'1',decisionDate:'2026-01-02',
  sourceUrl:'https://atosdecisorios.receita.fazenda.gov.br/consultaweb/index.jsf',abstract,
  sha256:createHash('sha256').update(abstract).digest('hex'),ncm:[],integrity:'abstract',jurisdiction:'BR'};
};
const seed=()=>seedLedger({records:[row()],lastSuccessfulCollectionAt:seedAt});
const run=(id='run1',dou='available')=>({id,at,collectorVersion:'test-only',window:{from:'2026-11-01',to:'2026-11-10'},sources:{
 receita:{status:'available',count:0,dateBasis:'decision'},dou:{status:dou,count:0,dateBasis:'publication'},
}});
const append=(ledger,receipt,receita=[])=>appendCollection(ledger,{
 ...receipt,sources:{receita:{...receipt.sources.receita,count:receita.length},dou:receipt.sources.dou},
},{receita,dou:[]});

test('falha inicial não desaparece após sucesso no último intervalo da mesma coleta',()=>{
 const first={...run('partial-first'),collectionId:'partial-collection',window:{from:'2026-10-14',to:'2026-10-27'}};
 first.sources.receita.status='unavailable';
 let ledger=append(seed(),first);
 const last={...run('partial-last'),collectionId:'partial-collection',at:'2026-11-10T12:01:00.000Z',window:{from:'2026-10-28',to:'2026-11-10'}};
 ledger=append(ledger,last,[row()]);
 const catalog=ledgerCatalog(ledger);
 assert.equal(catalog.sourceStatus.receita,'partial');
 assert.equal(catalog.sourceChecks.receita.status,'partial');
 assert.equal(catalog.sourceStatus.dou,'available');
 assert.equal(catalog.sourceChecks.receita.lastSuccessAt,last.at);
 assert.equal(catalog.lastSuccessfulCollectionAt,seedAt);
 assert.equal(catalog.records[0].observedAt,last.at);
 assert.equal(catalog.records.length,1);
});

test('coleta seguinte completa remove o estado parcial e atualiza o último sucesso integral',()=>{
 const first={...run('failed-first','unavailable'),collectionId:'failed-collection'};
 let ledger=append(seed(),first);
 ledger=append(ledger,{...run('failed-last'),collectionId:'failed-collection',at:'2026-11-10T12:01:00.000Z'});
 assert.equal(ledgerCatalog(ledger).sourceStatus.dou,'partial');
 ledger=append(ledger,{...run('recovered-first'),collectionId:'recovered-collection',at:'2026-11-11T12:00:00.000Z'});
 const end='2026-11-11T12:01:00.000Z';
 ledger=append(ledger,{...run('recovered-last'),collectionId:'recovered-collection',at:end});
 const catalog=ledgerCatalog(ledger);
 assert.equal(catalog.sourceStatus.receita,'available');assert.equal(catalog.sourceStatus.dou,'available');
 assert.equal(catalog.lastSuccessfulCollectionAt,end);
 assert.equal(ledger.runs.length,4);
});

test('recibos antigos continuam independentes e falha posterior conserva o último sucesso integral',()=>{
 const {revision,seedCollectedAt,...legacySeed}=seed();
 let ledger=append(sealLedger(legacySeed),run());
 const partial={...run('legacy-partial','unavailable'),at:'2026-11-11T12:00:00.000Z'};
 ledger=append(ledger,partial,[row()]);
 const catalog=ledgerCatalog(ledger);
 assert.equal(catalog.sourceStatus.receita,'available');assert.equal(catalog.sourceStatus.dou,'unavailable');
 assert.equal(catalog.lastSuccessfulCollectionAt,at);
 const noComplete=ledgerCatalog(append(sealLedger(legacySeed),partial,[row()]));
 assert.equal(noComplete.lastSuccessfulCollectionAt,seedAt);
});
