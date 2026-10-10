import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { normativeInstructions, retrievedSourceNames } from '../app/lib/classification-grounding.ts';

function loadRoute(path = "app/api/classificar/route.ts") {
  const module = {exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, {
    module, exports:module.exports, Response, process:{env:{OPENAI_API_KEY:'test-only'}}, setTimeout,
    fetch:(...args)=>globalThis.fetch(...args),
    require:(name)=> {
      if(name.endsWith('/documentos-temporarios')) return loadRoute('app/lib/documentos-temporarios.ts');
      if(name.endsWith('/cosit-retrieval')) return {retrieveCosit:async()=>({context:'',sources:[],status:'not_configured'}),cositInstructions:''};
      if(name.endsWith('/auth')) return {getPortalAccess:async()=>({status:'authorized'})};
      if(name.endsWith('/upload-token')) return {verifyUploadToken:()=>({fileId:'file_qa',filename:'Ficha.PDF',size:100})};
      if(name.endsWith('/classificador-prompt')) return {PROMPT_ID:'prompt_qa',PROMPT_VERSION:'1'};
      if(name.endsWith('/classification-grounding')) return {normativeInstructions,retrievedSourceNames};
      throw new Error(name);
    }
  });
  return module.exports;
}

test('anexo não substitui as ferramentas normativas; leitura e classificação são chamadas distintas',async()=>{
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    calls.push({url,body,method:init.method});
    if(url.endsWith('/vector_stores')&&init.method==='POST') return Response.json({id:'vs_temporary'});
    if(url.includes('/vector_stores/vs_temporary/files?')) return Response.json({data:[{status:'completed'}]});
    if(url.endsWith('/responses')) {
      if(body.model) return Response.json({status:'completed',output_text:'CAS e composição: evidência sintética de Ficha.PDF'});
      return Response.json({id:'resp_qa',output_text:JSON.stringify({ncm:'',confianca:10,classificacao:'Condicional',descricaoAduaneira:'Exemplo',justificativa:'Trecho não recuperado nesta análise',informacoesPendentes:'Validar fontes'}),output:[{type:'file_search_call',results:[{filename:'NESH.pdf'}]}]});
    }
    return Response.json({});
  };
  try {
    const response=await loadRoute().POST(new Request('https://qa.invalid/api/classificar',{method:'POST',body:JSON.stringify({descricao:'Produto teste',documentos:['token']})}));
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).retrievedSources,['NESH.pdf']);
    const responses=calls.filter(c=>c.url.endsWith('/responses'));
    assert.equal(responses.length,2);
    assert.deepEqual(responses[0].body.tools[0].vector_store_ids,['vs_temporary']);
    assert.equal(Object.hasOwn(responses[1].body,'tools'),false);
    assert.match(responses[1].body.input[0].content,/NÃO prova ausência/);
    assert.match(responses[1].body.input[1].content.at(-1).text,/evidência sintética/);
    assert.ok(calls.some(c=>c.url.endsWith('/vector_stores/vs_temporary')&&c.method==='DELETE'));
    assert.ok(calls.some(c=>c.url.endsWith('/files/file_qa')&&c.method==='DELETE'));
  } finally {globalThis.fetch=original;}
});

test('rastreabilidade deduplica somente arquivos realmente retornados',()=>{
  assert.deepEqual(retrievedSourceNames({output:[{type:'file_search_call',results:[{filename:'TEC.pdf'},{filename:'TEC.pdf'}]},{content:[{annotations:[{type:'file_citation',filename:'NESH.pdf'}]}]}]}),['TEC.pdf','NESH.pdf']);
  assert.deepEqual(retrievedSourceNames({output:[]}),[]);
});
