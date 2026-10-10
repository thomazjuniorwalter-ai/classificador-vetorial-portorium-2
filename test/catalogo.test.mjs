import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { regrasPorNcm, avaliarCadastro, avaliarCondicao, verificarEvidencia, validarValor, valoresDoProduto, normalizarNcmCatalogo } from '../app/lib/catalogo.ts';
import { lerPlanilhaCatalogo } from '../app/lib/catalogo-planilha.ts';
const base = JSON.parse(fs.readFileSync(new URL('./fixtures/catalogo-oficial.json', import.meta.url)));
// Subset of the official production relation retrieved 2026-10-03, version 358.
test('official chemical NCM separates Produto from Duimp and resolves child conditions', () => {
  const r = regrasPorNcm(base, '2915.90.90', '2026-10-03');
  assert.ok(r.campos.some(c => c.codigo === 'ATT_8571')); // CAS
  assert.ok(!r.campos.some(c => c.codigo === 'ATT_9332')); // Operation lot is DUIMP, not Produto.
  const forma = r.campos.find(c => c.codigo === 'ATT_9819');
  const filho = r.campos.find(c => c.pai === forma.chave);
  const gatilho = filho.condicao.valor;
  const sem = avaliarCadastro(r, {}).campos.find(c => c.campo.chave === filho.chave);
  assert.equal(sem.estado, 'condicao_pendente');
  const com = avaliarCadastro(r, { [forma.chave]: [gatilho] }).campos.find(c => c.campo.chave === filho.chave);
  assert.equal(com.estado, 'ausente');
  const outro = forma.dominio.find(v => v.codigo !== gatilho).codigo;
  assert.equal(avaliarCadastro(r, { [forma.chave]: [outro] }).campos.find(c => c.campo.chave === filho.chave).estado, 'nao_aplicavel');
});
test('official mechanical NCM with only Duimp attributes does not claim 100% compliance', () => {
  const r = regrasPorNcm(base, '84303190', '2026-10-03');
  assert.equal(r.campos.length, 0);
  assert.equal(avaliarCadastro(r, {}).completude, null);
});
test('filled official list stays under human review and invalid codes are rejected', () => {
  const r = regrasPorNcm(base, '29159090', '2026-10-03');
  r.campos = [r.campos.find(c => c.codigo === 'ATT_9819')];
  const campo = r.campos[0], code = campo.dominio[0].codigo;
  assert.ok(validarValor(campo, ['INVENTADO']).length);
  const valores = { [campo.chave]: [code] };
  assert.equal(avaliarCadastro(r, valores).campos[0].estado, 'revisar');
  assert.equal(avaliarCadastro(r, valores, { [campo.chave]: { valor: code, fonte: 'manual', trecho: 'texto', conflito: '', revisado: true } }).campos[0].estado, 'revisado');
  assert.equal(avaliarCadastro(r, valores, { [campo.chave]: { valor: code, fonte: 'manual', trecho: 'texto', conflito: 'divergência', revisado: true } }).campos[0].estado, 'conflito');
});
test('evidence must exist literally in the stated source and starts unreviewed', () => {
  const s = { valor: '15', fonte: 'manual.pdf', trecho: 'A potência nominal é 15 kW.', conflito: '' };
  assert.equal(verificarEvidencia(s, [{ nome: 'manual.pdf', texto: 'Potência não informada.' }]), null);
  assert.equal(verificarEvidencia(s, [{ nome: 'outro.pdf', texto: s.trecho }]), null);
  assert.equal(verificarEvidencia(s, [{ nome: 'manual.pdf', texto: s.trecho }]).revisado, false);
});
test('AND/OR rules and unanswered conditions remain conservative', () => {
  assert.equal(avaliarCondicao({ operador: '==', valor: '1', composicao: '||', condicao: { operador: '==', valor: '2' } }, ['2']), true);
  assert.equal(avaliarCondicao({ operador: '!=', valor: '1', composicao: '&&', condicao: { operador: '!=', valor: '2' } }, ['2']), false);
  assert.equal(avaliarCondicao({ operador: '==', valor: '1' }, []), null);
});
test('future and expired links are excluded; invalid NCMs are rejected', () => {
  const b = structuredClone(base);
  b.listaNcm.find(r => r.codigoNcm === '8537.20.90').listaAtributos.forEach(v => { v.dataInicioVigencia = '2099-01-01'; });
  assert.equal(regrasPorNcm(b, '85372090', '2026-10-03').campos.length, 0);
  assert.throws(() => normalizarNcmCatalogo('8537.A0.90'));
});
test('Excel audit retains full description, leading zeros and official multiple values', async () => {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('Produtos');
  s.addRow(['NCM', 'Denominação', 'Descrição', 'ATT_1']);
  s.addRow([1012100, 'Produto', 'D'.repeat(800), '01|99']);
  const [p] = await lerPlanilhaCatalogo(Buffer.from(await w.xlsx.writeBuffer()));
  assert.equal(p.ncm, '01012100'); assert.equal(p.descricao.length, 800);
  assert.deepEqual(valoresDoProduto(p).ATT_1, ['01', '99']);
  s.getCell('A2').value = { formula: '1+1', result: 2 };
  await assert.rejects(lerPlanilhaCatalogo(Buffer.from(await w.xlsx.writeBuffer())), /fórmulas/);
});

test('numeric official attribute accepts valid precision and rejects excess decimals', () => {
 const r = regrasPorNcm(base, '85372090', '2026-10-03');
 assert.deepEqual(validarValor(r.campos[0], ['15000.12345']), []);
 assert.ok(validarValor(r.campos[0], ['15000.123456']).length);
});
