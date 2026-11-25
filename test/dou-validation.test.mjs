import test from 'node:test';
import assert from 'node:assert/strict';
import {runValidation, validationWindows} from '../scripts/validate-dou-search.mjs';
const empty = '<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params">{"jsonArray":[]}</script>'
  + '<script>var request={currentPage:1,totalPages:0}</script>Exibindo 0 - 0 de 0 resultados';

test('validação limita datas e usa somente as duas janelas do incidente por padrão', () => {
  assert.deepEqual(validationWindows('', '', '2026-11-12'), [
    {from:'2026-09-26', to:'2026-10-09'}, {from:'2026-11-07', to:'2026-11-11'},
  ]);
  for (const dates of [['2026-11-07',''], ['2026-09-01','2026-11-11'], ['2026-11-01','2026-11-15']]) {
    assert.throws(() => validationWindows(...dates, '2026-11-12'));
  }
});

test('validação usa parser real, produz diagnóstico de vazio e não salva corpos/cookies', async () => {
  const calls = [];
  const report = await runValidation({today:'2026-11-12', transport:async (input, init) => {
    calls.push({url:new URL(input), init});
    return new Response(empty + '<div>private-example-value</div>', {headers:{'Set-Cookie':'private-cookie-value'}});
  }});
  assert.equal(report.status, 'complete'); assert.equal(report.requests, 2);
  assert.equal(report.results[0].acts, 0);
  assert.equal(report.results[0].responses[0].itemsCount, 0);
  assert.deepEqual(report.results[0].responses[0].counters, [['0','0','0']]);
  assert.equal(calls[0].url.origin, 'https://www.in.gov.br');
  assert.equal(calls[0].url.searchParams.get('publishFrom'), '26-09-2026');
  assert.equal(calls[1].url.searchParams.get('publishFrom'), '07-11-2026');
  assert.ok(calls.every(call => !call.init.headers && call.init.redirect === 'error'));
  assert.doesNotMatch(JSON.stringify(report), /private-example-value|private-cookie-value/);
});

test('validação mantém bloqueio e HTML inválido como falha sem incluir mensagem arbitrária', async () => {
  let call = 0;
  const report = await runValidation({today:'2026-11-12', transport:async () => ++call === 1
    ? new Response('private-blocked-body', {status:403})
    : new Response('<h1>Access Denied</h1><div>private-invalid-body</div>')});
  assert.equal(report.status, 'partial_or_failed');
  assert.equal(report.results[0].error.code, 'HTTP_UNAVAILABLE');
  assert.equal(report.results[1].error.code, 'DOU_MISSING_CATALOG');
  assert.equal(report.results[1].responses[0].blockedMessage, true);
  assert.doesNotMatch(JSON.stringify(report), /private-blocked-body|private-invalid-body/);
});

test('validação registra somente estrutura de paginação e rejeita resposta maior que 4 MB', async () => {
  const malformed = empty.replace('currentPage:1', 'currentPage:private-expression')
    .replace('"jsonArray":[]', '"jsonArray":[],"token":"private-payload-token"');
  const report = await runValidation({from:'2026-11-07', to:'2026-11-11', today:'2026-11-12',
    transport:async () => new Response(malformed)});
  assert.equal(report.status, 'partial_or_failed');
  assert.deepEqual(report.results[0].responses[0].pagination.currentPage, ['[non-numeric]']);
  assert.doesNotMatch(JSON.stringify(report), /private-expression|private-payload-token/);
  const oversized = await runValidation({from:'2026-11-07', to:'2026-11-11', today:'2026-11-12',
    transport:async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))});
  assert.equal(oversized.status, 'partial_or_failed');
  assert.equal(oversized.results[0].error.code, 'RESPONSE_TOO_LARGE');
});
