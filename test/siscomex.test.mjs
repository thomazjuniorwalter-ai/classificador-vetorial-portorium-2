import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { validarConsultaSiscomex, consultarProdutosSiscomex } from '../app/lib/siscomex-consulta.ts';
const input = { clientId: 'id-test-only', clientSecret: 'secret-test-only', cpfCnpjRaiz: '12345678', ncm: '85372090', ambiente: 'producao' };
const auth = () => new Response('{}', { headers: { 'Set-Token': 'jwt-test-only', 'X-CSRF-Token': 'csrf-test-only' } });
test('query validates environment, document and header values before transport', () => {
  assert.equal(validarConsultaSiscomex({ ...input, cpfCnpjRaiz: '12.345.678', ncm: '8537.20.90' }).ncm, '85372090');
  for (const invalid of [{ ambiente: 'https://evil.invalid' }, { clientSecret: 'secret\r\nHeader:value' }, { cpfCnpjRaiz: '1234567A' }, { ncm: '123' }]) assert.throws(() => validarConsultaSiscomex({ ...input, ...invalid }));
});
test('credentials go only to authentication; product access is GET and tokens stay server-side', async () => {
  const calls = [];
  const result = await consultarProdutosSiscomex(input, async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? auth() : Response.json([{ codigo: 12, versao: '1.1', ncm: '85372090' }]);
  });
  assert.equal(calls[0].url, 'https://portalunico.siscomex.gov.br/portal/api/autenticar/chave-acesso');
  assert.equal(calls[0].init.headers['Role-Type'], 'IMPEXP');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.headers.Authorization, 'jwt-test-only');
  assert.equal(calls[1].init.headers['Client-Secret'], undefined);
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(result.produtos[0].versao, '1.1');
  assert.ok(!JSON.stringify(result).includes('test-only'));
});
test('authentication failures prevent catalog calls and never echo provider secrets', async () => {
  let count = 0;
  await assert.rejects(() => consultarProdutosSiscomex(input, async () => { count++; return new Response('secret-test-only', { status: 422 }); }), e => !e.message.includes(input.clientSecret) && e.status === 422);
  assert.equal(count, 1);
});
test('empty and partial results are explicit; oversized and malformed results fail', async () => {
  for (const [response, check] of [[new Response(null, { status: 204 }), r => r.produtos.length === 0], [Response.json([{ codigo: 1 }], { status: 206 }), r => r.parcial]]) {
    let count = 0; assert.ok(check(await consultarProdutosSiscomex(input, async () => ++count === 1 ? auth() : response)));
  }
  for (const response of [Response.json(Array.from({ length: 51 }, () => ({ codigo: 1 }))), Response.json({ secret: 'test-only' }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    let count = 0; await assert.rejects(() => consultarProdutosSiscomex(input, async () => ++count === 1 ? auth() : response));
  }
});
function route(status, transport = async () => { throw new Error('secret-test-only'); }) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/catalogo/siscomex/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, Response, URL, require: name => name.endsWith('/auth') ? { getPortalAccess: async () => ({ status }), portalAccessResponse: () => new Response(null, { status: 401 }) } : { validarConsultaSiscomex, consultarProdutosSiscomex: transport, ErroSiscomex: class extends Error {} },
  }); return module.exports;
}
test('endpoint rejects unauthenticated or cross-origin calls and sanitizes transport errors', async () => {
  const req = origin => new Request('https://app.invalid/api/catalogo/siscomex', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal((await route('unauthenticated').POST(req('https://app.invalid'))).status, 401);
  assert.equal((await route('authorized').POST(req('https://evil.invalid'))).status, 403);
  const response = await route('authorized').POST(req('https://app.invalid'));
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret-test-only'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
