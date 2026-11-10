import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeDocuments,synchronizationPlan} from '../scripts/sync-cosit.mjs';
const document=(id='A')=>({record:{id,sha256:'new-'+id,sourceUrl:'https://www.in.gov.br/test',title:id,collectedAt:'2026-11-10'},text:'Teste'});
const old={id:'file_old',status:'completed',attributes:{collector:'cosit-pilot',decision_id:'A',sha256:'old',status:'indexed'}};
test('plano é local e não prevê retirada, inclusive com manifesto vazio',()=>{
 assert.deepEqual(synchronizationPlan([]),{mode:'dry_run',documents:[],retirements:0,deletions:0});
});
test('manifesto vazio é bloqueado antes de qualquer chamada externa',async()=>{
 await assert.rejects(synchronizeDocuments([],[old],()=>{throw Error('não deve chamar');},'/test'),/vazio/);
});
test('falha de indexação não retira a versão anterior nem publica as novas',async()=>{
 const calls=[];const api=async(endpoint,body)=>{calls.push({endpoint,body});
 if(endpoint==='/files')return {id:'file_new'};
 return {id:'file_new',status:'failed'};};
 await assert.rejects(synchronizeDocuments([document()],[old],api,'/files-store'),/não concluída/);
 assert.ok(calls.every(c=>!c.endpoint.includes('file_old')));
 assert.ok(calls.every(c=>c.body?.attributes?.status!=='indexed'));
});
test('todas as preparações antecedem indexação visível; nova execução reutiliza arquivos completos',async()=>{
 const existing=[old,...['A','B'].map(id=>({id:'file_'+id,status:'completed',attributes:{collector:'cosit-pilot',decision_id:id,sha256:'new-'+id,status:'pending'}}))];
 const calls=[];const api=async(endpoint,body)=>{calls.push({endpoint,body});return {};};
 const result=await synchronizeDocuments([document('A'),document('B')],existing,api,'/store');
 assert.equal(result.fullTexts,2);assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c.body.attributes.status==='indexed'&&!c.endpoint.includes('file_old')));
});
test('falha em outro documento não ativa o primeiro documento preparado',async()=>{
 const existing=[{id:'file_A',status:'completed',attributes:{collector:'cosit-pilot',decision_id:'A',sha256:'new-A',status:'pending'}},
 {id:'file_B',status:'failed',attributes:{collector:'cosit-pilot',decision_id:'B',sha256:'new-B',status:'pending'}}];
 const calls=[];
 await assert.rejects(synchronizeDocuments([document('A'),document('B')],existing,async(...args)=>{calls.push(args);},'/store'));
 assert.equal(calls.length,0);
});

test('retomada reutiliza upload registrado quando a associação ao store falhou',async()=>{
 const checkpoint={uploads:{},save:async()=>{}};let uploads=0;
 const api=async(endpoint,body)=>{if(endpoint==='/files'){uploads++;return {id:'file_upload'};}
 throw Error('associação falhou');};
 await assert.rejects(synchronizeDocuments([document()],[],api,'/store',undefined,checkpoint));
 assert.equal(checkpoint.uploads['A/new-A'],'file_upload');
 const result=await synchronizeDocuments([document()],[],async(endpoint,body)=>{
 assert.notEqual(endpoint,'/files');return {id:'file_upload',status:'completed',attributes:body.attributes};
 },'/store',undefined,checkpoint);
 assert.equal(uploads,1);assert.equal(result.fullTexts,1);
});
