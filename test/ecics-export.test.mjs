import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import * as triagem from '../app/lib/triagem.ts';
import {validateEcicsEvidenceSummary} from '../app/lib/ecics-presentation.ts';

const metadata = JSON.parse(fs.readFileSync('data/ecics/metadata.json', 'utf8'));
const catalog = JSON.parse(gunzipSync(Buffer.concat(metadata.indexChunks.map(chunk => fs.readFileSync('data/ecics/' + chunk.file)))));
const byCus = new Map(catalog.records.map(record => [record.cus, record]));
const match = cus => {
  const {casNumbers, cnCode, chemicalName, iupacName} = byCus.get(cus);
  return {cus, casNumbers, cnCode, hsCode: cnCode.length >= 6 ? cnCode.slice(0, 6) : null, chemicalName, iupacName};
};
const evidence = (matches, extra = {}) => ({
  status: 'retrieved', queriedCas: [...new Set(matches.flatMap(record => record.casNumbers))], invalidCas: [],
  exportedAt: metadata.exportedAt, xlsxSha256: metadata.xlsxSha256, matchMode: 'cas',
  totalMatches: matches.length, truncated: false, queryTruncated: false, ambiguousCas: [], matches, ...extra,
});
const details = {justificativa: 'Fundamento para revisão.', informacoesPendentes: [], fontes: ['Fonte normativa']};
const row = (ecics, extra = {}) => ({
  linha: 2, mercadoria: 'Mercadoria técnica', ncmCliente: '29141100', ncmSugerida: '29141100',
  confianca: 90, ...details, ...(ecics ? {ecics} : {}), ...extra,
});
const source = ts.transpileModule(fs.readFileSync('app/api/lote/exportar/route.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;

function route(access = 'authorized') {
  const module = {exports: {}};
  vm.runInNewContext(source, {
    module, exports: module.exports, Response, Request, Buffer, console,
    require: name => {
      if (name === 'exceljs') return ExcelJS;
      if (name.endsWith('/triagem')) return triagem;
      if (name.endsWith('/auth')) return {
        getPortalAccess: async () => ({status: access}),
        portalAccessResponse: () => Response.json({}, {status: 401}),
      };
      throw new Error(name);
    },
  });
  return module.exports;
}

async function exportRows(linhas, access) {
  return route(access).POST(new Request('https://qa.invalid/api/lote/exportar', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({linhas}),
  }));
}

async function readExport(response) {
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  return workbook;
}

test('XLSX real preserva dois CAS, proveniência e código parcial sem alterar NCM ou sinais', async () => {
  const chemicals = evidence([match('0010079-8'), match('0033862-5')]);
  const aluminium = evidence([match('0011083-8')]);
  const book = await readExport(await exportRows([
    row(chemicals, {codigoProduto: '000012'}),
    row(aluminium, {linha: 3, ncmCliente: '76011000', ncmSugerida: '76011000'}),
    row(undefined, {linha: 4, confianca: 79}),
  ]));
  const sheet = book.getWorksheet('Triagem');
  assert.equal(sheet.getCell('L1').value, 'Referências ECICS');
  const text = sheet.getCell('L2').text;
  for (const expected of ['67-64-1', '102-71-6', '0010079-8', '0033862-5', '29141100', '29221500', metadata.exportedAt, metadata.xlsxSha256]) {
    assert.ok(text.includes(expected), 'missing evidence: ' + expected);
  }
  assert.match(text, /propan-2-one/);
  assert.match(text, /CN europeu e NCM brasileira são campos distintos/);
  assert.match(sheet.getCell('L3').text, /CN europeu 76 · SH da referência não detalhado até seis dígitos/);
  assert.doesNotMatch(sheet.getCell('L3').text, /CN europeu 76000000/);
  assert.equal(sheet.getCell('C2').value, '2914.11.00');
  assert.equal(sheet.getCell('D2').value, '2914.11.00');
  assert.equal(sheet.getCell('C3').value, '7601.10.00');
  assert.equal(sheet.getCell('D3').value, '7601.10.00');
  assert.equal(sheet.getCell('F2').value, 'VERDE');
  assert.equal(sheet.getCell('F3').value, 'VERDE');
  assert.equal(sheet.getCell('F4').value, 'AMARELO');
  assert.equal(sheet.getCell('F2').fill.fgColor.argb, 'FFDBF3E2');
  assert.equal(sheet.getCell('G2').value, '000012');
  assert.equal(sheet.getCell('J2').value, 'Fonte normativa');
  assert.equal(sheet.getCell('L4').text, '');
  assert.ok(book.getWorksheet('Como interpretar'));
});

test('exportação preserva qualificações de preparações e alerta de ambiguidades', async () => {
  const input = evidence([match('0026971-6'), match('0130136-6')], {ambiguousCas: ['108-65-6'], truncated: true, totalMatches: 10});
  const sheet = (await readExport(await exportRows([row(input)]))).getWorksheet('Triagem');
  const text = sheet.getCell('L2').text;
  assert.match(text, /sensitising emulsion/);
  assert.match(text, /photosensitive acid precursors/);
  assert.match(text, /CAS associados a códigos CN diferentes: 108-65-6/);
  assert.match(text, /Consulta limitada/);
  assert.match(text, /não são exaustivas/);
});

test('célula longa é limitada com aviso e mantém limitações antes do corte', async () => {
  const records = Array.from({length: 7}, (_, index) => ({
    ...match('0010079-8'), cus: String(index + 100).padStart(7, '0') + '-0', chemicalName: 'x'.repeat(6_000), iupacName: '',
  }));
  const input = evidence(records, {ambiguousCas: ['67-64-1'], truncated: true});
  const sheet = (await readExport(await exportRows([row(input)]))).getWorksheet('Triagem');
  const text = sheet.getCell('L2').text;
  assert.ok(text.length <= 32_767);
  assert.match(text, /abreviadas no Excel pelo limite de 32.767 caracteres/);
  assert.match(text, /CAS com códigos CN diferentes: 67-64-1/);
  assert.match(text, /A recuperação ECICS foi limitada/);
  assert.ok(text.includes(metadata.xlsxSha256));
});

test('nomes não são interpretados como HTML ou fórmulas no XLSX', async () => {
  const input = evidence([{...match('0010079-8'), chemicalName: '<b>Nome literal</b>\n=HYPERLINK("https://qa.invalid","x")', iupacName: ''}]);
  const sheet = (await readExport(await exportRows([row(input)]))).getWorksheet('Triagem');
  const cell = sheet.getCell('L2');
  assert.equal(cell.type, ExcelJS.ValueType.String);
  assert.equal(cell.formula, undefined);
  assert.ok(cell.text.includes('<b>Nome literal</b>'));
  assert.ok(cell.text.includes('=HYPERLINK'));
});

test('evidência malformada é recusada e campos antigos continuam opcionais', async () => {
  const valid = evidence([match('0010079-8')]);
  assert.equal(validateEcicsEvidenceSummary(undefined), undefined);
  for (const input of [
    null,
    {...valid, matches: [{...valid.matches[0], cnCode: '2914110000'}]},
    {...valid, matches: [{...valid.matches[0], hsCode: '999999'}]},
    {...valid, matches: [{...valid.matches[0], casNumbers: ['67-64-2']}]},
    {...valid, xlsxSha256: {formula: '1+1'}},
    {...valid, matches: [{...valid.matches[0], chemicalName: {text: 'fake'}}]},
  ]) {
    assert.throws(() => validateEcicsEvidenceSummary(input));
    assert.equal((await exportRows([{...row(undefined), ecics: input}])).status, 400);
  }
  assert.equal((await exportRows([row(undefined)])).status, 200);
  assert.equal((await exportRows([row(valid)], 'unauthenticated')).status, 401);
  assert.equal((await exportRows(Array.from({length: 51}, (_, i) => row(valid, {linha: i + 2})))).status, 400);
});

test('o limite adicional de evidências não amplia os limites existentes de entrada', async () => {
  const records = Array.from({length: 20}, (_, index) => ({
    ...match('0010079-8'), cus: String(index + 100).padStart(7, '0') + '-0', chemicalName: 'x'.repeat(6_000), iupacName: '',
  }));
  assert.equal((await exportRows([row(evidence(records))])).status, 400);
  assert.equal((await exportRows([row(evidence([match('0010079-8')]), {mercadoria: 'x'.repeat(2_501)})])).status, 400);
});
