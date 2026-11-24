import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('app/lib/ecics-retrieval.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
const record = (cus, casNumbers, cnCode, chemicalName, extra = {}) => ({
  cus, casNumbers, cnCode, chemicalName, iupacName: chemicalName, nomenclature: 'IUPAC', synonyms: [], ...extra,
});
const records = [
  record('0010079-8', ['67-64-1'], '29141100', 'acetone', {iupacName: 'propan-2-one'}),
  record('pure-ester', ['108-65-6'], '29153900', '2-methoxy-1-methylethyl acetate'),
  record('formulated-ester', ['108-65-6'], '37071000', 'sensitising emulsion containing an acrylate, photosensitive component and solvent'),
  record('triethanolamine', ['102-71-6'], '29221500', 'triethanolamine'),
  record('mixed-solvents', ['67-64-1', '108-65-6'], '38140090', 'prepared organic composite solvents'),
];

function library(options = {}) {
  const data = {schemaVersion: 1, records: options.records ?? records};
  const rawIndex = Buffer.from(JSON.stringify(data));
  const compressed = zlib.gzipSync(rawIndex);
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const files = new Map();
  for (let offset = 0; offset < compressed.length; offset += 131_072) {
    files.set(`index.json.gz.${String(files.size).padStart(4, '0')}`, compressed.subarray(offset, offset + 131_072));
  }
  const manifest = {
    schemaVersion: 1, exportedAt: '2026-11-24T13:39:34Z', recordCount: data.records.length,
    validCasCount: 3, xlsxSha256: 'test-file-sha256', sourceUrl: 'https://ec.europa.eu/',
    indexSha256: digest(rawIndex), compressedIndexSha256: digest(compressed), compressedIndexSizeBytes: compressed.length,
    indexChunks: [...files].map(([file, bytes]) => ({file, size: bytes.length, sha256: digest(bytes)})),
    ...(options.manifest ?? {}),
  };
  options.mutateManifest?.(manifest);
  const module = {exports: {}};
  let reads = 0;
  const readPaths = [];
  vm.runInNewContext(source, {
    module, exports: module.exports, console, Buffer,
    process: {cwd: () => '/ecics-test'},
    require: name => {
      if (name === 'node:path') return path;
      if (name === 'node:zlib') return zlib;
      if (name === 'node:crypto') return crypto;
      if (name === 'node:fs/promises') return {readFile: async filename => {
        reads++;
        readPaths.push(filename);
        if (options.unavailable) throw new Error('unavailable fixture');
        if (filename.endsWith('metadata.json')) return JSON.stringify(manifest);
        const file = path.basename(filename);
        if (file === options.missingChunk || !files.has(file)) throw new Error('missing chunk');
        if (file === options.tamperChunk) {
          const bytes = Buffer.from(files.get(file));
          bytes[bytes.length - 1] ^= 1;
          return bytes;
        }
        return options.corrupt ? Buffer.from('broken gzip') : files.get(file);
      }};
      throw new Error(name);
    },
  });
  return {...module.exports, readCount: () => reads, readPaths: () => readPaths};
}
const plain = value => JSON.parse(JSON.stringify(value));

test('CAS validado aceita traços Unicode e espaços e preserva referências por CUS', async () => {
  const api = library();
  const result = await api.retrieveEcics('Trietanolamina, CAS 102 – 71 – 6, pureza 99%.');
  assert.equal(result.status, 'retrieved');
  assert.deepEqual(plain(result.queriedCas), ['102-71-6']);
  assert.equal(result.matches[0].cnCode, '29221500');
  assert.equal(result.matches[0].hsCode, '292215');
  assert.equal(result.matches[0].cus, 'triethanolamine');
  assert.equal(Object.hasOwn(result.matches[0], 'ncm'), false);
  assert.match(result.sources[0], /ECICS \/ Comissão Europeia.*CUS triethanolamine.*102-71-6/);
  assert.equal(result.metadata.exportedAt, '2026-11-24T13:39:34Z');
  assert.equal(result.metadata.sourceCreatedAt, result.metadata.exportedAt);
  await api.retrieveEcics('CAS 67-64-1');
  assert.equal(api.readCount(), 2, 'o arquivo e manifesto são lidos uma vez por instância');
});

test('mesmo CAS conserva substância e preparação com códigos diferentes sem escolher o primeiro', async () => {
  const result = await library().retrieveEcics('CAS 108-65-6');
  assert.equal(result.metadata.totalMatches, 3);
  assert.equal(result.matches.length, 3);
  assert.deepEqual(plain(result.metadata.cnCodes), ['29153900', '37071000', '38140090']);
  assert.deepEqual(plain(result.metadata.ambiguousCas), ['108-65-6']);
  assert.match(result.context, /sensitising emulsion/);
  assert.match(result.context, /Não escolher automaticamente o primeiro/);
  assert.match(result.context, /componente de uma mistura/);
});

test('vários CAS não duplicam um CUS e registram quais identificadores corresponderam', async () => {
  const result = await library().retrieveEcics('CAS 67-64-1; CAS 108-65-6; CAS 67-64-1');
  assert.equal(result.matches.length, 4);
  assert.equal(result.matches.filter(item => item.cus === 'mixed-solvents').length, 1);
  assert.deepEqual(plain(result.matches.find(item => item.cus === 'mixed-solvents').matchedCas), ['67-64-1', '108-65-6']);
});

test('níveis europeus de 2 e 4 dígitos nunca são completados; HS6 só existe a partir de 6 dígitos', async () => {
  const result = await library({records: [
    record('chapter', ['67-64-1'], '29', 'chapter reference'),
    record('heading', ['67-64-1'], '2914', 'heading reference'),
    record('subheading', ['67-64-1'], '291411', 'subheading reference'),
  ]}).retrieveEcics('CAS 67-64-1');
  assert.deepEqual(plain(result.matches.map(item => [item.cnCode, item.hsCode])), [
    ['29', null], ['2914', null], ['291411', '291411'],
  ]);
  assert.doesNotMatch(result.context, /29000000|29140000/);
});

test('CAS inválido, CAS não encontrado e consulta sem identificador têm estados distintos', async () => {
  const api = library();
  assert.equal(api.normalizeCasNumber('67-64-2'), null);
  assert.equal(api.normalizeCasNumber('0-00-0'), null);
  const invalid = await api.retrieveEcics('acetone, CAS 67-64-2 e 0-00-0');
  assert.equal(invalid.status, 'invalid_cas');
  assert.equal(invalid.sources.length, 0);
  assert.match(invalid.context, /identificadores informados não passaram/);
  const missing = await api.retrieveEcics('CAS 7732-18-5');
  assert.equal(missing.status, 'no_matches');
  assert.match(missing.context, /não prova inexistência/);
  assert.equal(missing.sources.length, 0);
  assert.equal((await api.retrieveEcics('escavadeira hidráulica')).status, 'not_applicable');
});

test('busca nominal exige alias completo com fronteiras e CAS explícito tem precedência', async () => {
  const api = library();
  const exact = await api.retrieveEcics('Nome químico: acetone');
  assert.equal(exact.status, 'retrieved');
  assert.equal(exact.metadata.matchMode, 'name');
  assert.equal(exact.matches[0].cus, '0010079-8');
  assert.equal((await api.retrieveEcics('acetones')).status, 'not_applicable');
  assert.equal((await api.retrieveEcics('acetone hydrate')).status, 'not_applicable');
  assert.equal((await api.retrieveEcics('Produto: acetone hydrate')).status, 'not_applicable');
  const explicit = await api.retrieveEcics('acetone, CAS 7732-18-5');
  assert.equal(explicit.status, 'no_matches');
  assert.equal(explicit.metadata.matchMode, 'cas');
});

test('falha de arquivo, gzip ou manifesto nunca é reportada como ausência de substância', async () => {
  for (const options of [{unavailable: true}, {corrupt: true}, {manifest: {recordCount: 999}}, {manifest: {indexSha256: 'wrong-hash'}}]) {
    const api = library(options);
    const result = await api.retrieveEcics('CAS 67-64-1');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.sources.length, 0);
    assert.match(result.context, /base está indisponível/);
    assert.equal((await api.getEcicsStatus()).available, false);
  }
});

test('partes do gzip são reunidas na ordem declarada e o catálogo continua em cache', async () => {
  const large = [record('large', ['67-64-1'], '29141100', 'acetone', {
    synonyms: [crypto.randomBytes(200_000).toString('base64')],
  })];
  const api = library({records: large});
  const result = await api.retrieveEcics('CAS 67-64-1');
  assert.equal(result.status, 'retrieved');
  assert.equal(result.matches[0].cnCode, '29141100');
  assert.deepEqual(api.readPaths().map(file => path.basename(file)), ['metadata.json', 'index.json.gz.0000', 'index.json.gz.0001']);
  await api.getEcicsStatus();
  assert.equal(api.readCount(), 3);
});

test('manifestos com caminhos inseguros, ordem inválida ou limites excedidos não leem partes', async () => {
  const mutations = [
    manifest => { manifest.indexChunks[0].file = '../index.json.gz.0000'; },
    manifest => { manifest.indexChunks[0].file = '/tmp/index.json.gz.0000'; },
    manifest => { manifest.indexChunks[0].file = 'index.json.gz.0001'; },
    manifest => { manifest.indexChunks = []; },
    manifest => { manifest.indexChunks = Array.from({length: 257}, () => manifest.indexChunks[0]); },
    manifest => { manifest.indexChunks[0].size = 131_073; },
    manifest => { manifest.indexChunks[0].size = 0; },
    manifest => { manifest.indexChunks[0].sha256 = 'invalid'; },
    manifest => { manifest.compressedIndexSizeBytes += 1; },
  ];
  for (const mutateManifest of mutations) {
    const api = library({mutateManifest});
    const result = await api.retrieveEcics('CAS 67-64-1');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.sources.length, 0);
    assert.equal(api.readCount(), 1, 'somente o manifesto é lido antes de rejeitar descritores inválidos');
  }
});

test('parte faltante, tamanho, hash de parte e hashes agregados falham de forma explícita', async () => {
  const options = [
    {missingChunk: 'index.json.gz.0000'},
    {tamperChunk: 'index.json.gz.0000'},
    {mutateManifest: manifest => { manifest.indexChunks[0].sha256 = '0'.repeat(64); }},
    {mutateManifest: manifest => { manifest.indexChunks[0].size--; manifest.compressedIndexSizeBytes--; }},
    {manifest: {compressedIndexSha256: '0'.repeat(64)}},
    {manifest: {indexSha256: '0'.repeat(64)}},
  ];
  for (const option of options) {
    const result = await library(option).retrieveEcics('CAS 67-64-1');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.sources.length, 0);
    assert.match(result.context, /base está indisponível/);
  }
});

test('CAS sem hífen exige rótulo quando pode ser SH/NCM; CAS longo inválido não vira substring válida', async () => {
  const api = library();
  assert.deepEqual(plain(api.extractCasNumbers('CAS 67641').valid), ['67-64-1']);
  assert.deepEqual(plain(api.extractCasNumbers('CAS RN: 102716').valid), ['102-71-6']);
  assert.deepEqual(plain(api.extractCasNumbers('67641').valid), ['67-64-1']);
  assert.deepEqual(plain(api.extractCasNumbers('NCM 29141100; SH 291411').valid), []);
  assert.deepEqual(plain(api.extractCasNumbers('29141100').valid), []);
  assert.deepEqual(plain(api.extractCasNumbers('102716').valid), []);
  assert.deepEqual(plain(api.extractCasNumbers('12345678-90-6').valid), []);
  assert.deepEqual(plain(api.extractCasNumbers('12345678-90-6').invalid), ['12345678-90-6']);
  assert.equal((await api.retrieveEcics('CAS 67641')).status, 'retrieved');
  assert.equal((await api.retrieveEcics('CAS 67642')).status, 'invalid_cas');
});

test('limites de registros e contexto informam truncamento e preservam contagem total', async () => {
  const many = Array.from({length: 35}, (_, index) => record(`cus-${index}`, ['67-64-1'], '29141100', `chemical-${index}`));
  const result = await library({records: many}).retrieveEcics('CAS 67-64-1');
  assert.equal(result.metadata.totalMatches, 35);
  assert.equal(result.metadata.retrievedCount, 20);
  assert.equal(result.metadata.truncated, true);
  assert.equal(result.sources.length, result.matches.length);
  assert.ok(result.context.length <= 24_000);
  assert.match(result.context, /não são exaustivas/);
  const long = await library({records: many.map(item => ({...item, chemicalName: 'a'.repeat(5000)}))}).retrieveEcics('CAS 67-64-1');
  assert.equal(long.metadata.fieldsTruncated, true);
  assert.equal(long.metadata.truncated, true);
  assert.ok(long.context.length <= 24_000);
});

test('limite de texto é explícito e CAS além do antigo limite de 8k continua pesquisável', async () => {
  const api = library();
  const result = await api.retrieveEcics('Descrição '.repeat(1000) + 'CAS 102-71-6');
  assert.equal(result.status, 'retrieved');
  assert.equal(result.metadata.queryTruncated, false);
  const limited = await api.retrieveEcics('CAS 102-71-6 ' + 'x'.repeat(40_000));
  assert.equal(limited.metadata.queryTruncated, true);
  assert.equal(limited.metadata.truncated, true);
  assert.ok(limited.context.length <= 24_000);
  const late = await api.retrieveEcics('x'.repeat(40_000) + ' CAS 102-71-6');
  assert.equal(late.metadata.queryTruncated, true);
  assert.equal(late.matches.length, 0);
  assert.equal(late.status, 'not_applicable');
  assert.match(late.context, /limitada ao trecho inicial/);
  assert.match(late.context, /restante do texto não foi examinado/);
  assert.equal(late.sources.length, 0);
});

test('instruções preservam origem oficial e exigem validação de NCM sem fingir vigência', () => {
  const instructions = library().ecicsInstructions;
  assert.match(instructions, /CN europeia NÃO é NCM/);
  assert.match(instructions, /não é vinculante/);
  assert.match(instructions, /mesmo quando só há um CAS/);
  assert.match(instructions, /não comprova vigência/);
  assert.match(instructions, /não complete com zeros/);
  assert.match(instructions, /não execute|nunca execute/);
});
