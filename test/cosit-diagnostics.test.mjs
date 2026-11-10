import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionFailureDiagnostics,logCollectionFailures} from '../scripts/cosit-diagnostics.mjs';
import {collectReceita,collectDou,RECEITA_SOURCE,DOU_SOURCE} from '../app/lib/cosit-abstracts.ts';

test('diagnóstico identifica a fonte com falha sem descartar a fonte que respondeu',()=>{
  const rows=[{id:'official-record'}];
  const results=[{status:'rejected',reason:new Error('Receita: formulário indisponível')},
    {status:'fulfilled',value:rows}];
  const diagnostics=collectionFailureDiagnostics(results,{window:{from:'2026-11-01',to:'2026-11-09'}});
  assert.equal(diagnostics.length,1);
  assert.equal(diagnostics[0].source,'receita');
  assert.equal(diagnostics[0].error.code,'RECEITA_MISSING_FORM');
  assert.deepEqual(diagnostics[0].window,{from:'2026-11-01',to:'2026-11-09'});
  assert.equal(results[1].value,rows);
});

test('erros inesperados não expõem URLs, credenciais, stack ou contexto arbitrário',()=>{
  const secret='private-test-token';
  const reason=Object.assign(new Error(`request https://user:${secret}@example.com failed`),
    {code:secret,cause:{code:secret,message:secret}});
  const logs=[];
  logCollectionFailures([{status:'rejected',reason},{status:'fulfilled',value:[]}],
    {window:{from:secret,to:'2026-11-09'},token:secret},line=>logs.push(line));
  const line=logs.join('\n');
  assert.doesNotMatch(line,/private-test-token|example\.com|https:|stack/);
  const parsed=JSON.parse(line);
  assert.equal(parsed.error.code,'UNEXPECTED_COLLECTOR_ERROR');
  assert.equal(Object.hasOwn(parsed,'window'),false);
});

test('falhas de rede e timeout conservam apenas códigos e mensagens seguros',()=>{
  const network=new TypeError('fetch failed',{cause:{code:'ECONNRESET',message:'secret-value'}});
  const timeout=new DOMException('secret-timeout-context','TimeoutError');
  const diagnostics=collectionFailureDiagnostics([{status:'rejected',reason:network},{status:'rejected',reason:timeout}]);
  assert.deepEqual(diagnostics.map(x=>[x.source,x.error.code]),[['receita','ECONNRESET'],['dou','TIMEOUT']]);
  assert.doesNotMatch(JSON.stringify(diagnostics),/secret-/);
});

test('HTTP registra status numérico validado e sucesso não produz alerta',()=>{
  const reason=Object.assign(new Error('Fonte oficial indisponível'),{status:503});
  const diagnostic=collectionFailureDiagnostics([{status:'rejected',reason}])[0];
  assert.equal(diagnostic.error.httpStatus,503);
  reason.status='503 token';
  assert.equal(Object.hasOwn(collectionFailureDiagnostics([{status:'rejected',reason}])[0].error,'httpStatus'),false);
  assert.deepEqual(collectionFailureDiagnostics([{status:'fulfilled',value:[]},{status:'fulfilled',value:[]}]),[]);
});

test('coletores reais preservam status HTTP e não registram o corpo da resposta',async()=>{
  const calls=[];
  const transport=async(url,options)=>{
    calls.push({url,options});
    return new Response('confidential-response-body',{status:503});
  };
  const results=await Promise.allSettled([
    collectReceita('2026-11-01','2026-11-09',transport),
    collectDou('2026-11-01','2026-11-09',transport),
  ]);
  const diagnostics=collectionFailureDiagnostics(results);
  assert.deepEqual(diagnostics.map(x=>[x.source,x.error.httpStatus]),[['receita',503],['dou',503]]);
  assert.equal(calls.length,3);
  assert.ok(calls.every(({url,options})=>(url===RECEITA_SOURCE||url.startsWith(`${DOU_SOURCE}?`))
    && options.redirect==='error' && options.signal instanceof AbortSignal));
  assert.doesNotMatch(JSON.stringify(diagnostics),/confidential-response-body/);
});

test('timeout do transporte continua sendo falha e é distinguido de erro HTTP',async()=>{
  const transport=async()=>{throw new DOMException('private-timeout-context','TimeoutError');};
  const results=await Promise.allSettled([
    collectReceita('2026-11-01','2026-11-09',transport),
    collectDou('2026-11-01','2026-11-09',transport),
  ]);
  assert.ok(results.every(result=>result.status==='rejected'));
  const diagnostics=collectionFailureDiagnostics(results);
  assert.deepEqual(diagnostics.map(x=>x.error.code),['TIMEOUT','TIMEOUT']);
  assert.doesNotMatch(JSON.stringify(diagnostics),/private-timeout-context|httpStatus/);
});
