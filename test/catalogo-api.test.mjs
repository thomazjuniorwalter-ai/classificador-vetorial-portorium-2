import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalogo from '../app/lib/catalogo.ts';
const base = JSON.parse(fs.readFileSync(new URL('./fixtures/catalogo-oficial.json', import.meta.url)));
function load(path, access = 'authorized') {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, Response, Request, File, Buffer, Intl, Date, AbortSignal, setTimeout, process: { env: { OPENAI_API_KEY: 'test-only' } }, fetch: (...args) => globalThis.fetch(...args),
    require: name => {
      if (name.endsWith('/auth')) return { getPortalAccess: async () => ({ status: access }), portalAccessResponse: () => Response.json({ error: 'Sessão expirada' }, { status: 401 }) };
      if (name.endsWith('/catalogo')) return catalogo;
      if (name.endsWith('/catalogo-base')) return { carregarBaseCatalogo: async () => base, consultarRegrasCatalogo: async ncm => catalogo.regrasPorNcm(base, ncm, '2026-10-03') };
      if (name.endsWith('/catalogo-planilha')) return {};
      if (name.endsWith('/documentos-temporarios')) return load('app/lib/documentos-temporarios.ts', access);
      if (name.endsWith('/upload-token')) return { verifyUploadToken: () => ({ fileId: 'file_qa', filename: 'manual.pdf', size: 100 }) };
      throw new Error(name);
    },
  });
  return module.exports;
}
test('all catalog routes require the existing authorized session', async () => {
  for (const [file, method] of [['atributos', 'GET'], ['preparar', 'POST'], ['auditar', 'POST']]) {
    const route = load(`app/api/catalogo/${file}/route.ts`, 'unauthenticated');
    assert.equal((await route[method](new Request('https://qa.invalid/api/catalogo', { method }))).status, 401);
  }
});
test('preparation accepts only traceable suggestions and cleans up temporary documents', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method });
    if (url.endsWith('/vector_stores') && init.method === 'POST') return Response.json({ id: 'vs_qa' });
    if (url.includes('/files?')) return Response.json({ data: [{ status: 'completed' }] });
    if (url.endsWith('/responses')) return Response.json({ status: 'completed', output_text: JSON.stringify({ sugestoes: [
      { chave: 'ATT_13220', valor: '15000', fonte: 'manual.pdf', trecho: 'Tensão máxima: 15000 volts.', conflito: '' },
      { chave: 'ATT_INVENTADO', valor: '1', fonte: 'manual.pdf', trecho: 'Tensão máxima: 15000 volts.', conflito: '' },
    ] }), output: [{ type: 'file_search_call', results: [{ file_id: 'file_qa', filename: 'manual.pdf', text: 'Tensão máxima: 15000 volts.' }] }] });
    return Response.json({});
  };
  try {
    const response = await load('app/api/catalogo/preparar/route.ts').POST(new Request('https://qa.invalid/api/catalogo/preparar', { method: 'POST', body: JSON.stringify({ ncm: '85372090', documentos: ['token'] }) }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.evidencias.ATT_13220.valor, '15000');
    assert.equal(data.evidencias.ATT_13220.revisado, false);
    assert.equal(data.evidencias.ATT_INVENTADO, undefined);
    assert.match(data.aviso, /descartadas/);
    assert.ok(calls.some(c => c.url.endsWith('/vector_stores/vs_qa') && c.method === 'DELETE'));
    assert.ok(calls.some(c => c.url.endsWith('/files/file_qa') && c.method === 'DELETE'));
  } finally { globalThis.fetch = original; }
});
test('audit reports bad official values and returns a compact report without duplicate rule bases', async () => {
  const response = await load('app/api/catalogo/auditar/route.ts').POST(new Request('https://qa.invalid/api/catalogo/auditar', { method: 'POST', body: JSON.stringify([{ ncm: '85372090', denominacao: 'Painel', descricao: 'Painel elétrico', atributos: [{ codigo: 'ATT_13220', valor: 'abc' }] }]) }));
  assert.equal(response.status, 200);
  const { resultados } = await response.json();
  assert.equal(resultados[0].status, 'pendencias');
  assert.ok(resultados[0].achados.some(a => /decimal/.test(a)));
  assert.equal(resultados[0].regras, undefined);
});
