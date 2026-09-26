import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  normalizarNcm, ncmExibicao, colunaDeClassificacao,
  descricaoMercadoria, sinalizarTriagem,
} from "../app/lib/triagem.ts";
import { ErroPlanilha, lerPlanilhaTriagem } from "../app/lib/excel-triagem.ts";

test("normaliza NCM com pontos e recupera zero perdido por célula numérica", () => {
  assert.equal(normalizarNcm("0101.21.00"), "01012100");
  assert.equal(normalizarNcm("1012100", true), "01012100");
  assert.equal(normalizarNcm("1012100"), null);
  assert.equal(normalizarNcm("0101.21.A0"), null);
  assert.equal(ncmExibicao("01012100"), "0101.21.00");
});

test("prepara apenas informações técnicas, mesmo se a coluna NCM for selecionada", () => {
  const colunas = [
    { indice: 1, titulo: "Produto" },
    { indice: 2, titulo: "Composição" },
    { indice: 3, titulo: "NCM do cliente" },
    { indice: 4, titulo: "Classificação fiscal informada" },
  ];
  const linha = { linha: 2, celulas: { 1: "Fibra têxtil", 2: "100% algodão", 3: "5201.00.20", 4: "5201.00.20" } };
  const descricao = descricaoMercadoria(linha, colunas, [1, 2, 3, 4]);
  assert.match(descricao, /Fibra têxtil/);
  assert.match(descricao, /100% algodão/);
  assert.doesNotMatch(descricao, /5201/);
  assert.equal(colunaDeClassificacao("NCM sugerida"), true);
});

test("cores priorizam coincidência e divergência somente com estimativa alta", () => {
  assert.equal(sinalizarTriagem("0101.21.00", "01012100", 80), "verde");
  assert.equal(sinalizarTriagem("0101.21.00", "01012100", 79), "amarelo");
  assert.equal(sinalizarTriagem("0101.21.00", "02012100", 80), "vermelho");
  assert.equal(sinalizarTriagem("0101.21.00", "02012100", 79), "amarelo");
  assert.equal(sinalizarTriagem("0101.21.00", "", 0), "amarelo");
});

test("lê um .xlsx real e mantém a NCM numérica para comparação", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Lista");
  sheet.addRow(["Produto", "Composição", "NCM do cliente"]);
  sheet.addRow(["Mercadoria para análise", "Material conhecido", 1012100]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const planilha = await lerPlanilhaTriagem(bytes, "amostra.xlsx");
  assert.equal(planilha.aba, "Lista");
  assert.equal(planilha.linhas[0].celulas[1], "Mercadoria para análise");
  assert.equal(normalizarNcm(planilha.linhas[0].celulas[3], true), "01012100");
});

test("bloqueia fórmulas e mais de 50 mercadorias antes das chamadas de IA", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Lista");
  sheet.addRow(["Produto", "NCM"]);
  sheet.addRow(["Produto", { formula: "1+1", result: 2 }]);
  await assert.rejects(
    lerPlanilhaTriagem(Buffer.from(await workbook.xlsx.writeBuffer()), "formula.xlsx"),
    (error) => error instanceof ErroPlanilha && /fórmulas/.test(error.message)
  );

  const grande = new ExcelJS.Workbook();
  const outra = grande.addWorksheet("Lista");
  outra.addRow(["Produto", "NCM"]);
  for (let i = 0; i < 51; i++) outra.addRow([`Produto ${i}`, "0101.21.00"]);
  await assert.rejects(
    lerPlanilhaTriagem(Buffer.from(await grande.xlsx.writeBuffer()), "grande.xlsx"),
    (error) => error instanceof ErroPlanilha && /mais de 50/.test(error.message)
  );
});
