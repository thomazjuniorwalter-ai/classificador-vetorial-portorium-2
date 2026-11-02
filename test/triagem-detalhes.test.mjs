import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import * as triagem from '../app/lib/triagem.ts';
import * as grounding from '../app/lib/classification-grounding.ts';

const detalhes = { justificativa: 'Fundamento recuperado para revisão.', informacoesPendentes: [], fontes: ['Norma.pdf'] };
function load(file, { access = 'authorized', resposta, calls = [] } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, Response, Request, Buffer, console,
    process: { env: { OPENAI_API_KEY: 'test-only' } },
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json(resposta); },
    require: name => {
      if (name === 'exceljs') return ExcelJS;
      if (name.endsWith('/triagem')) return triagem;
      if (name.endsWith('/classification-grounding')) return grounding;
      if (name.endsWith('/classificador-prompt')) return { PROMPT_ID: 'test', PROMPT_VERSION: '1' };
      if (name.endsWith('/cosit-retrieval')) return { retrieveCosit: async () => ({sources: ['Ementa oficial: teste'], context: 'Ementa', status: 'retrieved'}), cositInstructions: '' };
      if (name.endsWith('/auth')) return { getPortalAccess: async () => ({status: access}), portalAccessResponse: () => Response.json({}, {status: 401}) };
      throw new Error(name);
    }
  });
  return module.exports;
}
const request = body => new Request('https://qa.invalid', {method: 'POST', body: JSON.stringify(body)});

test('pendências prevalecem sobre coincidência e confiança alta', () => {
  assert.equal(triagem.sinalizarTriagem('01012100', '01012100', 99, ['Qual a finalidade?']), 'amarelo');
  assert.equal(triagem.sinalizarTriagem('01012100', '01012100', NaN), 'amarelo');
  assert.throws(() => triagem.validarDetalhesTriagem({...detalhes, informacoesPendentes: [42]}));
});

test('classificação devolve detalhes, fontes recuperadas e não envia NCM do cliente', async () => {
  const calls = [];
  const route = load('app/api/lote/classificar/route.ts', {calls, resposta: { output_text: JSON.stringify({...detalhes, ncm: '01012100', confianca: 90}), output: [{type: 'file_search_call', results: [{filename: 'Norma.pdf'}]}] }});
  const response = await route.POST(request({descricao: 'Mercadoria com descrição técnica', ncmCliente: '99999999'}));
  const data = await response.json();
  assert.equal(data.ncm, '01012100');
  assert.deepEqual(data.fontes, ['Norma.pdf', 'Ementa oficial: teste']);
  assert.equal(data.justificativa, detalhes.justificativa);
  assert.doesNotMatch(JSON.stringify(calls), /99999999/);
});

test('API retira sugestão quando existe pendência, mesmo com confiança alta', async () => {
  const route = load('app/api/lote/classificar/route.ts', {resposta: { output_text: JSON.stringify({...detalhes, ncm: '01012100', confianca: 99, informacoesPendentes: ['Qual é a finalidade?']}) }});
  const data = await (await route.POST(request({descricao: 'Descrição insuficiente do produto'}))).json();
  assert.equal(data.ncm, ''); assert.equal(data.confianca, 0);
  assert.deepEqual(data.informacoesPendentes, ['Qual é a finalidade?']);
});

test('exportação XLSX preserva código, fundamento, pendências, fontes e erros', async () => {
  const linhas = [
    {linha: 2, codigoProduto: '000012', mercadoria: 'Produto', ncmCliente: '01012100', ncmSugerida: '01012100', confianca: 90, ...detalhes},
    {linha: 3, mercadoria: 'Produto incerto', ncmCliente: '01012100', ncmSugerida: '', confianca: 0, ...detalhes, informacoesPendentes: ['Informar composição']},
    {linha: 4, mercadoria: 'Falhou', ncmCliente: '01012100', erro: 'Serviço indisponível'},
    {linha: 5, mercadoria: 'Pendente', ncmCliente: '01012100'},
  ];
  const response = await load('app/api/lote/exportar/route.ts').POST(request({linhas}));
  assert.equal(response.status, 200);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = book.getWorksheet('Triagem');
  assert.equal(sheet.getCell('G2').value, '000012');
  assert.equal(sheet.getCell('H2').value, detalhes.justificativa);
  assert.equal(sheet.getCell('I3').value, 'Informar composição');
  assert.equal(sheet.getCell('J2').value, 'Norma.pdf');
  assert.equal(sheet.getCell('F2').value, 'VERDE');
  assert.equal(sheet.getCell('F3').value, 'AMARELO');
  assert.equal(sheet.getCell('F4').value, 'FALHA');
  assert.equal(sheet.getCell('K4').value, 'Serviço indisponível');
  assert.equal(sheet.getCell('F5').value, 'NÃO ANALISADO');
  assert.ok(book.getWorksheet('Como interpretar'));
});

test('rotas exigem sessão e exportação recusa detalhes inválidos', async () => {
  for (const name of ['classificar', 'exportar']) {
    assert.equal((await load(`app/api/lote/${name}/route.ts`, {access: 'unauthenticated'}).POST(request({}))).status, 401);
  }
  assert.equal((await load('app/api/lote/exportar/route.ts').POST(request({linhas: [{linha:2, mercadoria:'Produto', ncmCliente:'01012100', confianca:90, ...detalhes, fontes:[{}]}]}))).status, 400);
});

test('exportação rejeita listas malformadas também em linhas não analisadas', async () => {
  const response = await load('app/api/lote/exportar/route.ts').POST(request({linhas: [{linha:2, mercadoria:'Produto', ncmCliente:'01012100', fontes:{}}]}));
  assert.equal(response.status, 400);
});
