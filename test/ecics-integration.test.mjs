import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as ecics from '../app/lib/ecics-retrieval.ts';
import * as presentation from '../app/lib/ecics-presentation.ts';
import * as grounding from '../app/lib/classification-grounding.ts';
import * as triagem from '../app/lib/triagem.ts';
import * as uploads from '../app/lib/upload-limits.ts';
import { classificationReportSections } from '../app/lib/classification-report.ts';

const pendingResult = {
  classificacao: 'Composição a confirmar', ncm: '', confianca: 0,
  descricaoAduaneira: 'Produto químico', justificativa: 'Conferir formulação e normas brasileiras.',
  informacoesPendentes: 'Informar composição e pureza.',
};

function route(file, { access = 'authorized', responses = [], extracted = '', moduleOverride, filename = 'ficha.PDF', extractionCalls = [] } = {}) {
  const module = { exports: {} };
  const retrieval = moduleOverride || ecics;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, Response, Request, console,
    process: { env: { OPENAI_API_KEY: 'test-only' } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      responses.push(body);
      const result = file.includes('/lote/') ? { ...pendingResult, informacoesPendentes: ['Informar composição e pureza.'] } : pendingResult;
      return Response.json({ id: 'resp_test', output_text: JSON.stringify(result), output: [{ type: 'file_search_call', results: [{ filename: 'NESH.pdf' }] }] });
    },
    require: name => {
      if (name.endsWith('/ecics-retrieval')) return retrieval;
      if (name.endsWith('/ecics-presentation')) return presentation;
      if (name.endsWith('/classification-grounding')) return grounding;
      if (name.endsWith('/classificador-prompt')) return { PROMPT_ID: 'saved_prompt_test', PROMPT_VERSION: '1' };
      if (name.endsWith('/triagem')) return triagem;
      if (name.endsWith('/upload-limits')) return uploads;
      if (name.endsWith('/auth')) return { getPortalAccess: async () => ({ status: access }), portalAccessResponse: () => Response.json({}, { status: 401 }) };
      if (name.endsWith('/cosit-retrieval')) return { retrieveCosit: async () => ({ context: 'Ementa Cosit de teste.', sources: ['Ementa Cosit de teste'], status: 'retrieved' }), cositInstructions: 'Preservar pesquisa Cosit.' };
      if (name.endsWith('/upload-token')) return { verifyUploadToken: () => ({ fileId: 'file_test', filename, size: 120 }) };
      if (name.endsWith('/documentos-temporarios')) return {
        createTemporaryVectorStore: async files => files.length ? 'vs_test' : null,
        deleteVectorStore: async () => {}, deleteDocuments: async () => {},
        openAiJson: async (_url, _key, options) => { extractionCalls.push(JSON.parse(options.body)); return { status: 'completed', output_text: extracted }; },
        outputText: response => response.output_text || '',
      };
      throw new Error(name);
    },
  });
  return module.exports;
}
const request = body => new Request('https://qa.invalid/api/classificar', { method: 'POST', body: JSON.stringify(body) });

test('análise individual consulta o extrato real e mantém CN separada da NCM produzida pelo modelo', async () => {
  const responses = [];
  const response = await route('app/api/classificar/route.ts', { responses }).POST(request({ descricao: 'Acetona CAS 67-64-1, solvente industrial.' }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result.ncm, ''); // A referência não preenche NCM por conta própria.
  assert.equal(data.ecics.status, 'retrieved');
  assert.equal(data.ecics.matches[0].cnCode, '29141100');
  assert.equal(data.ecics.matches[0].hsCode, '291411');
  assert.equal(data.ecics.matches[0].cus, '0010079-8');
  assert.equal(Object.hasOwn(data.ecics, 'context'), false);
  assert.equal(Object.hasOwn(data.ecics.matches[0], 'synonyms'), false);
  assert.ok(data.retrievedSources.includes('NESH.pdf'));
  assert.ok(data.retrievedSources.includes('Ementa Cosit de teste'));
  assert.ok(data.retrievedSources.some(source => source.includes('ECICS') && source.includes('0010079-8')));
  const body = responses[0];
  assert.equal(Object.hasOwn(body, 'tools'), false); // Não substitui ferramentas do prompt salvo.
  assert.equal(body.prompt.id, 'saved_prompt_test');
  assert.match(body.input[0].content, /CN europeia NÃO é NCM/);
  assert.ok(body.input[1].content.some(part => part.text?.includes('0010079-8')));
});

test('CAS recuperado de PDF alimenta a consulta ECICS mesmo sem CAS na descrição digitada', async () => {
  const response = await route('app/api/classificar/route.ts', { extracted: 'A ficha.PDF informa trietanolamina, CAS 102-71-6.' }).POST(request({ descricao: 'Consultar a ficha técnica.', documentos: ['test_token'] }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.ecics.queriedCas, ['102-71-6']);
  assert.equal(data.ecics.matches[0].cnCode, '29221500');
});

test('lote usa ECICS real e conserva pendências; a NCM do cliente não é enviada ao modelo', async () => {
  const responses = [];
  const response = await route('app/api/lote/classificar/route.ts', { responses }).POST(request({ descricao: 'Solvente CAS 108-65-6, composição a confirmar.', ncmCliente: '99999999' }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ncm, '');
  assert.equal(data.confianca, 0);
  assert.ok(data.ecics.matches.some(match => match.cnCode === '29153900'));
  assert.ok(data.ecics.matches.some(match => match.cnCode === '37071000'));
  assert.ok(data.ecics.ambiguousCas.includes('108-65-6'));
  assert.ok(data.fontes.some(source => source.includes('ECICS')));
  assert.doesNotMatch(JSON.stringify(responses), /99999999/);
});

test('planilhas e imagens são lidas antes da consulta ECICS, com conteúdo direto apropriado', async () => {
  for (const [filename, type] of [['composicao.xlsx', 'input_file'], ['rotulo.png', 'input_image']]) {
    const extractionCalls = [], responses = [];
    const response = await route('app/api/classificar/route.ts', {
      filename, extractionCalls, responses, extracted: `${filename}: bicarbonato de sódio CAS 144-55-8.`,
    }).POST(request({ descricao: '', documentos: ['test_token'] }));
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ecics.matches[0].cnCode, '28363000');
    assert.equal(extractionCalls.length, 1);
    assert.equal(Object.hasOwn(extractionCalls[0], 'tools'), false);
    assert.equal(extractionCalls[0].input[0].content[1].type, type);
    assert.ok(responses[0].input[1].content.some(part => part.type === type));
    assert.ok(responses[0].input[1].content.some(part => part.text?.includes('0023301-2')));
  }
});

test('acesso ECICS e classificações exigem autorização antes de carregar dados ou chamar IA', async () => {
  const moduleOverride = {
    getEcicsStatus: () => { throw new Error('Não deve ler o índice'); },
    retrieveEcics: () => { throw new Error('Não deve pesquisar'); },
  };
  for (const file of ['app/api/classificar/route.ts', 'app/api/lote/classificar/route.ts', 'app/api/ecics/status/route.ts']) {
    const api = route(file, { access: 'unauthenticated', moduleOverride });
    const response = api.GET ? await api.GET() : await api.POST(request({ descricao: 'CAS 67-64-1' }));
    assert.equal(response.status, 401);
  }
});

test('status autenticado informa a quantidade e a data do extrato efetivamente legível', async () => {
  const response = await route('app/api/ecics/status/route.ts').GET();
  const data = await response.json();
  assert.equal(data.available, true);
  assert.equal(data.recordCount, 112927);
  assert.equal(data.validCasCount, 106652);
  assert.equal(data.exportedAt, '2026-11-24T13:39:34Z');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('PDF e Word compartilham rastreabilidade ECICS com data, hash e alternativas de classificação', async () => {
  const evidence = presentation.ecicsEvidenceSummary(await ecics.retrieveEcics('CAS 1321-74-0'));
  const sections = classificationReportSections({ result: pendingResult, description: 'Divinilbenzeno', filenames: [], analyzedAt: '2026-11-24T15:00:00Z', analyst: 'Teste', ecics: evidence });
  const trace = sections.find(section => section.title.includes('Rastreabilidade')).content.join('\n');
  assert.match(trace, /29029000/);
  assert.match(trace, /38249992/);
  assert.match(trace, /b65134930d8f61ce/);
  assert.match(trace, /2026-11-24T13:39:34Z/);
  assert.match(trace, /CN europeu e NCM brasileira são campos distintos/);
});
