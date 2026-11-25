import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDou, parseDouSearch} from '../app/lib/cosit-abstracts.ts';

// Synthetic contract fixtures: the affected official pages could not be
// captured in this environment (HTTP 502). These are not production captures.
const payloadId = '_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params';
function search({items = [], pagination = 'currentPage:1,totalPages:1', label = ''} = {}) {
  return `<script id="${payloadId}">${JSON.stringify({jsonArray:items})}</script>`
    + (pagination === null ? '' : `<script>var request={${pagination}}</script>`) + label;
}
const entry = (id) => ({title:'Outro ato', urlTitle:`ato-${id}`,
  classPK:String(id), displayDateSortable:'1794355200000', score:1});

test('vazio exige catálogo vazio e declaração explícita compatível', () => {
  for (const fixture of [
    search({pagination:'currentPage:1,totalPages:0', label:'Exibindo 0 - 0 de 0 resultados'}),
    search({label:'Exibindo <strong>0</strong>&nbsp;–&nbsp;<strong>0</strong> de <b>0</b> resultados'}),
  ]) {
    assert.deepEqual(parseDouSearch(fixture), {items:[], totalPages:0, currentPage:1, total:0});
  }
});

test('vazio não encobre metadados ausentes, contraditórios ou texto de script', () => {
  for (const fixture of [
    'Nenhum resultado encontrado',
    '<html><h1>Access Denied</h1><p>Verifique o captcha.</p></html>',
    search(),
    search({pagination:null, label:'Nenhum resultado encontrado'}),
    search({pagination:null, label:'Exibindo 0 - 0 de 0 resultados'}),
    search({label:'<script>const placeholder="Nenhum resultado encontrado";</script>'}),
    search({label:'<!-- Nenhum resultado encontrado -->'}),
    search({label:'<template>Nenhum resultado encontrado</template>'}),
    search({label:'<h1>Access Denied</h1><div hidden>Nenhum resultado encontrado</div>'}),
    search({label:'<h1>Access Denied</h1><div style="display:none">Nenhum resultado encontrado</div>'}),
    search({label:'Exibindo 1 - 1 de 1 resultado'}),
    search({pagination:'currentPage:2,totalPages:2', label:'Nenhum resultado encontrado'}),
    search({pagination:'currentPage:1,totalPages:7', label:'Nenhum resultado encontrado'}),
    search({pagination:'currentPage:0,totalPages:0', label:'Exibindo 0 - 0 de 0 resultados'}),
    ...['currentPage:1e6,totalPages:0', 'currentPage:1.5,totalPages:0',
      'currentPage:1,totalPages:0.5', 'currentPage:1,totalPages:-1',
      'currentPage:1,totalPages:0,totalPages:9', 'currentPage:1,currentPage:2,totalPages:0',
      'currentPage:1,totalPages:0+1', 'currentPage:1,totalPages:'].map(pagination =>
      search({pagination, label:'Exibindo 0 - 0 de 0 resultados'})),
    `<script id="${payloadId}">null</script>Exibindo 0 - 0 de 0 resultados`,
    `<script id="${payloadId}">{}</script>Exibindo 0 - 0 de 0 resultados`,
  ]) assert.throws(() => parseDouSearch(fixture), /DOU:/);
});

test('contagem positiva aceita marcação de apresentação e singular', () => {
  const items = [entry(1)];
  assert.deepEqual(parseDouSearch(search({items,
    label:'<div>Exibindo <b>1</b>&nbsp;—&nbsp;<b>1</b> de <b>1</b> resultado.</div>'})),
    {items, totalPages:1, currentPage:1, total:1});
});

test('contagem positiva rejeita truncamento, limite e paginação incoerente', () => {
  for (const fixture of [
    search({items:[entry(1)], label:'Exibindo 1 - 2 de 2 resultados'}),
    search({items:[entry(1)], label:'Exibindo 1 - 1 de 2 resultados'}),
    search({items:[entry(1)], pagination:'currentPage:0,totalPages:1', label:'Exibindo 1 - 1 de 1 resultado'}),
    search({items:[entry(1)], pagination:'currentPage:2,totalPages:1', label:'Exibindo 1 - 1 de 1 resultado'}),
    search({items:[entry(1)], pagination:'currentPage:1,totalPages:0', label:'Exibindo 1 - 1 de 1 resultado'}),
    search({items:[entry(1)], pagination:'currentPage:1,totalPages:7', label:'Exibindo 1 - 1 de 451 resultados'}),
    search({items:[entry(1)], pagination:null, label:'Exibindo 1 - 1 de 1 resultado'}),
    search({items:[entry(1)], label:'<script>const template="Exibindo 1 - 1 de 1 resultado";</script>'}),
  ]) assert.throws(() => parseDouSearch(fixture), /DOU: contagem ou paginação não confirmada/);
});

test('coletor encerra uma busca vazia confirmada sem buscar artigos', async () => {
  const calls = [];
  const records = await collectDou('2026-11-07', '2026-11-11', async url => {
    calls.push(new URL(url));
    return new Response(search({pagination:'currentPage:1,totalPages:0', label:'Exibindo 0 - 0 de 0 resultados'}));
  });
  assert.deepEqual(records, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('publishFrom'), '07-11-2026');
  assert.equal(calls[0].searchParams.get('publishTo'), '11-11-2026');
});

test('coletor mantém indisponibilidade para bloqueio HTTP ou HTML incompleto', async () => {
  await assert.rejects(collectDou('2026-11-07', '2026-11-11', async () =>
    new Response('Access Denied', {status:403})), /Fonte oficial indisponível/);
  await assert.rejects(collectDou('2026-11-07', '2026-11-11', async () =>
    new Response(search())), /DOU: contagem ou paginação não confirmada/);
});

test('coletor segue cursor e confere cobertura de múltiplas páginas', async () => {
  const calls = [];
  const pages = [
    search({items:[entry(1)], pagination:'currentPage:1,totalPages:2', label:'Exibindo 1 - 1 de 2 resultados'}),
    search({items:[entry(2)], pagination:'currentPage:2,totalPages:2', label:'Exibindo 2 - 2 de 2 resultados'}),
  ];
  assert.deepEqual(await collectDou('2026-11-07', '2026-11-11', async url => {
    calls.push(new URL(url)); return new Response(pages[calls.length - 1]);
  }), []);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('newPage'), '2');
  assert.equal(calls[1].searchParams.get('id'), '1');
  await assert.rejects(collectDou('2026-11-07', '2026-11-11', async url =>
    new Response(new URL(url).searchParams.has('newPage')
      ? search({pagination:'currentPage:1,totalPages:0', label:'Exibindo 0 - 0 de 0 resultados'}) : pages[0])),
    /DOU: paginação não respeitada/);
});
