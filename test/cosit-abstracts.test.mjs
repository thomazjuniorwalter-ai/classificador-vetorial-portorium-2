import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseDouArticle,parseDouSearch,parseReceita,mergeAbstracts} from '../app/lib/cosit-abstracts.ts';
import {selectAbstracts,cosine} from '../app/lib/cosit-semantic.ts';
const url='https://www.in.gov.br/web/dou/-/solucao-de-consulta-n-98.292-733740133';
const text='Assunto: Classificação de Mercadorias\nCódigo NCM 8424.89.90\nMercadoria: Equipamento de combate a incêndio autopropulsado.\nDispositivos Legais: RGI 1 e RGC 1 da NCM.';
const act=(number,abstract=text)=>`<p class="identifica">SOLUÇÃO DE CONSULTA Nº ${number}, DE 3 DE SETEMBRO DE 2026</p>${abstract.split('\n').map(t=>`<p>${t}</p>`).join('')}<p class="assina">Autoridade</p>`;
const article=(...acts)=>`Coordenação-Geral de Tributação<div class="texto-dou">${acts.join('')}</div>`;
test('DOU separa várias decisões na mesma publicação e conserva ementa e NCM',()=>{
 const rows=parseDouArticle(article(act('98.292'),act('98.293',text.replace('8424.89.90','8509.80.90'))),url);
 assert.equal(rows.length,2);assert.equal(rows[1].id,'BR-COSIT-SC-98293-2026');
 assert.deepEqual(rows[0].ncm,['8424.89.90']);assert.equal(rows[0].abstract,text);assert.equal(rows[0].integrity,'abstract');
 assert.throws(()=>parseDouArticle(article(act('98.292')),url.replace('www.in.gov.br','example.com')));
 assert.throws(()=>parseDouArticle(article(act('98.292',text.replace('Dispositivos Legais:','Ausente:'))),url));
});
test('busca DOU e Receita rejeitam respostas sem confirmação de contagem',()=>{
 const search=`<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params">{"jsonArray":[{"urlTitle":"ato"}]}</script><script>var request={currentPage:1,totalPages:1}</script>Exibindo 1 - 1 de 1 resultados`;
 assert.equal(parseDouSearch(search).total,1);assert.throws(()=>parseDouSearch(search.replace('1 - 1','1 - 2')));
 assert.throws(()=>parseReceita('Total de atos localizados: 1'));
 assert.equal(parseReceita('Total de atos localizados: 0').records.length,0);
});
test('cruzamento deduplica por ato e sinaliza divergência sem substituir silenciosamente',()=>{
 const [r]=parseDouArticle(article(act('98.292')),url);
 const receita={...r,sourceUrl:'https://atosdecisorios.receita.fazenda.gov.br/consultaweb/index.jsf',sourceUrls:undefined};
 assert.equal(mergeAbstracts([],[receita],[r]).length,1);
 const merged=mergeAbstracts([],[receita],[{...r,abstract:text+' Alteração.'}])[0];
 assert.equal(merged.abstract,text);assert.equal(merged.conflictingSources,true);assert.equal(merged.sourceUrls.length,2);
});
test('busca semântica ordena por vetor, exclui outra jurisdição e não guarda consultas',async()=>{
 const rows=parseDouArticle(article(act('98.292'),act('98.293',text.replace('Equipamento','Outro aparelho'))),url);
 const calls=[];
 const transport=async(_,init)=>{const body=JSON.parse(init.body);calls.push(body);return Response.json({data:body.input.map((s,index)=>({index,embedding:[s.includes('Outro')||s==='consulta'?0:1,s.includes('Outro')||s==='consulta'?1:0,...Array(510).fill(0)]}))});};
 const result=await selectAbstracts('consulta',[...rows,{...rows[0],id:'US',jurisdiction:'US'}],'test-only',transport);
 assert.equal(result.mode,'semantic');assert.equal(result.records[0].number,'98293');assert.equal(result.records.length,2);
 await selectAbstracts('consulta',rows,'test-only',transport);assert.equal(calls.length,3);assert.equal(calls[2].input.length,1);
 assert.equal(cosine([1,0],[0,1]),0);
});
test('falha de embeddings mantém busca textual e informa fallback',async()=>{
 const rows=parseDouArticle(article(act('98.292')),url);
 const result=await selectAbstracts('incêndio',rows,'test-only',async()=>Response.json({}, {status:503}));
 assert.equal(result.mode,'lexical_fallback');assert.equal(result.records.length,1);
});
test('indisponibilidade de ambas as fontes conserva data da captura anterior',async()=>{
 const module={exports:{}};const snapshot={records:[],lastSuccessfulCollectionAt:'2026-09-01T00:00:00Z'};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/lib/cosit-catalog.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,
 {module,exports:module.exports,Intl,Date,Promise,require:name=>name==='next/cache'?{unstable_cache:fn=>fn}:name.includes('candidates')?snapshot:{collectReceita:async()=>{throw Error('offline')},collectDou:async()=>{throw Error('offline')},mergeAbstracts}});
 const catalog=await module.exports.getCositCatalog();assert.equal(catalog.refreshStatus,'fallback');assert.equal(catalog.lastSuccessfulCollectionAt,snapshot.lastSuccessfulCollectionAt);
 assert.equal(module.exports.catalogMetadata(catalog).stale,true);
});
test('recuperação usa ementa exata e link DOU sem depender de store de íntegra',async()=>{
 const [row]=parseDouArticle(article(act('98.292')),url);const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/lib/cosit-retrieval.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,
 {module,exports:module.exports,process:{env:{}},require:name=>name.includes('cosit-catalog')?{getCositCatalog:async()=>({records:[row]}),catalogMetadata:()=>({abstracts:1})}:name.includes('cosit-semantic')?{selectAbstracts:async()=>({records:[row],mode:'semantic'})}:{records:[]}});
 const result=await module.exports.retrieveCosit('incêndio','test-only');
 assert.equal(result.status,'retrieved');assert.ok(result.context.includes(text));assert.match(result.context,/EMENTA OFICIAL/);
 assert.match(result.context,/sem inteiro teor/);assert.ok(result.sources[0].includes(url));assert.equal(result.mode,'semantic');
});
test('status requer autorização antes de consultar fontes',async()=>{
 const module={exports:{}};let accessed=false;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/cosit/status/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,
 {module,exports:module.exports,Response,require:name=>name.endsWith('/auth')?{getPortalAccess:async()=>({status:'unauthenticated'}),portalAccessResponse:()=>new Response('',{status:401})}:{getCositCatalog:async()=>{accessed=true;},catalogMetadata:()=>({})}});
 assert.equal((await module.exports.GET()).status,401);assert.equal(accessed,false);
});
