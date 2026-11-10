import test from 'node:test';
import assert from 'node:assert/strict';

const library = name => import(new URL(`../app/lib/cosit-semantic.ts?cache-test=${name}`, import.meta.url));
const vector = target => {
  const values = Array(512).fill(0);
  values[0] = target ? 1 : 0.8;
  values[1] = target ? 0 : 0.6;
  return values;
};
const corpus = (prefix, count, targetIndex = 0) => Array.from({length: count}, (_, index) => ({
  id: `${prefix}-${index}`, sha256: `${prefix}-hash-${index}`,
  authority: 'Cosit', jurisdiction: 'BR', integrity: 'abstract',
  abstract: `${prefix} ${index === targetIndex ? 'target' : 'other'} abstract ${index}`,
}));
function transportFor(rows, queryHook) {
  const abstracts = new Set(rows.map(row => row.abstract));
  const calls = {abstracts: 0, queries: 0};
  const transport = async (_url, init) => {
    const {input} = JSON.parse(init.body);
    for (const text of input) {
      if (abstracts.has(text)) calls.abstracts++;
      else {
        calls.queries++;
        if (queryHook) await queryHook(text);
      }
    }
    return Response.json({data: input.map((text, index) => ({
      index, embedding: vector(!abstracts.has(text) || text.includes(' target ')),
    }))});
  };
  return {transport, calls};
}

test('ranqueia todo o corpus acima de 1000 e conserva o limite do cache compartilhado', async () => {
  const {selectAbstracts} = await library('large');
  const rows = corpus('large', 1005);
  const {transport, calls} = transportFor(rows);
  const result = await selectAbstracts('consulta', rows, 'test-only', transport);
  assert.equal(result.mode, 'semantic');
  assert.equal(result.records[0].id, rows[0].id);
  assert.equal(calls.abstracts, 1005);

  // Os 1000 mais recentes continuam reutilizáveis; um item antigo precisa ser gerado novamente.
  await selectAbstracts('consulta recente', rows.slice(5), 'test-only', transport);
  assert.equal(calls.abstracts, 1005);
  await selectAbstracts('consulta antiga', [rows[0]], 'test-only', transport);
  assert.equal(calls.abstracts, 1006);
});

test('consultas simultâneas compartilham todos os vetores gerados acima do limite do cache', async () => {
  const {selectAbstracts} = await library('parallel');
  const rows = corpus('parallel', 1005);
  const {transport, calls} = transportFor(rows);
  const results = await Promise.all([
    selectAbstracts('consulta A', rows, 'test-only', transport),
    selectAbstracts('consulta B', rows, 'test-only', transport),
  ]);
  for (const result of results) {
    assert.equal(result.mode, 'semantic');
    assert.equal(result.records[0].id, rows[0].id);
  }
  assert.equal(calls.abstracts, 1005);
  assert.equal(calls.queries, 2);
});

test('uma consulta em andamento preserva seus vetores enquanto outro corpus renova o cache', async () => {
  const {selectAbstracts} = await library('eviction');
  const original = corpus('original', 50, 40);
  const replacement = corpus('replacement', 1005);
  let releaseQuery;
  const queryHeld = new Promise(resolve => { releaseQuery = resolve; });
  let queryStarted;
  const queryReady = new Promise(resolve => { queryStarted = resolve; });
  const {transport} = transportFor([...original, ...replacement], async text => {
    if (text === 'consulta suspensa') {
      queryStarted();
      await queryHeld;
    }
  });
  await selectAbstracts('preparar cache', original, 'test-only', transport);
  const pending = selectAbstracts('consulta suspensa', original, 'test-only', transport);
  await queryReady;
  try {
    await selectAbstracts('substituir cache', replacement, 'test-only', transport);
  } finally {
    releaseQuery();
  }
  const result = await pending;
  assert.equal(result.mode, 'semantic');
  assert.equal(result.records[0].id, original[40].id);
});
