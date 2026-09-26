import ExcelJS from "exceljs";
import { MAX_LINHAS_TRIAGEM, type ColunaPlanilha, type LinhaPlanilha } from "./triagem.ts";

const MAX_COLUNAS = 30;
const MAX_CARACTERES_CELULA = 350;
const MAX_BYTES_DESCOMPACTADOS = 15 * 1024 * 1024;
const MAX_PARTES_ZIP = 150;

export type PlanilhaTriagem = {
  planilha: string;
  aba: string;
  colunas: ColunaPlanilha[];
  linhas: LinhaPlanilha[];
};

export class ErroPlanilha extends Error {}

// Limita o tamanho antes de descompactar e analisar o conteúdo no servidor.
function verificarTamanhoZip(bytes: Buffer) {
  const inicioBusca = Math.max(0, bytes.length - 65_557);
  let fim = -1;
  for (let posicao = bytes.length - 22; posicao >= inicioBusca; posicao--) {
    if (bytes.readUInt32LE(posicao) === 0x06054b50) { fim = posicao; break; }
  }
  if (fim < 0 || fim + 22 > bytes.length) throw new ErroPlanilha("O arquivo .xlsx está incompleto.");
  const partes = bytes.readUInt16LE(fim + 10);
  const posicaoCentral = bytes.readUInt32LE(fim + 16);
  if (!partes || partes > MAX_PARTES_ZIP || posicaoCentral >= bytes.length || partes === 0xffff || posicaoCentral === 0xffffffff) {
    throw new ErroPlanilha("A planilha é grande ou contém arquivos demais.");
  }
  let posicao = posicaoCentral;
  let descompactado = 0;
  for (let index = 0; index < partes; index++) {
    if (posicao + 46 > bytes.length || bytes.readUInt32LE(posicao) !== 0x02014b50) {
      throw new ErroPlanilha("O arquivo .xlsx está incompleto.");
    }
    descompactado += bytes.readUInt32LE(posicao + 24);
    if (descompactado > MAX_BYTES_DESCOMPACTADOS) {
      throw new ErroPlanilha("A planilha contém dados demais. Envie somente as mercadorias a analisar.");
    }
    posicao += 46 + bytes.readUInt16LE(posicao + 28) + bytes.readUInt16LE(posicao + 30) + bytes.readUInt16LE(posicao + 32);
  }
}

export async function lerPlanilhaTriagem(bytes: Buffer, nome: string): Promise<PlanilhaTriagem> {
  if (bytes.length < 22 || bytes.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new ErroPlanilha("O arquivo não é uma planilha .xlsx válida.");
  }
  verificarTamanhoZip(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets.find((item) => item.actualRowCount > 1);
  if (!sheet) throw new ErroPlanilha("Não há mercadorias na planilha.");
  const cabecalho = sheet.getRow(1);
  if (!cabecalho.cellCount || cabecalho.cellCount > MAX_COLUNAS) {
    throw new ErroPlanilha(`Use até ${MAX_COLUNAS} colunas com títulos na primeira linha.`);
  }
  const colunas = Array.from({ length: cabecalho.cellCount }, (_, index) => {
    const celula = cabecalho.getCell(index + 1);
    if (celula.type === ExcelJS.ValueType.Formula || celula.formula) {
      throw new ErroPlanilha("Copie e cole os valores das fórmulas antes de enviar a planilha.");
    }
    return { indice: index + 1, titulo: celula.text.trim().slice(0, 70) || `Coluna ${index + 1}` };
  });
  const linhas: LinhaPlanilha[] = [];
  let formulaDetectada = false;
  sheet.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1) return;
    if (row.cellCount > MAX_COLUNAS) throw new ErroPlanilha(`A linha ${numero} ultrapassa ${MAX_COLUNAS} colunas.`);
    const celulas: Record<number, string> = {};
    for (const coluna of colunas) {
      const celula = row.getCell(coluna.indice);
      if (celula.type === ExcelJS.ValueType.Formula || celula.formula) {
        formulaDetectada = true;
        return;
      }
      celulas[coluna.indice] = celula.text.trim().slice(0, MAX_CARACTERES_CELULA);
    }
    if (Object.values(celulas).some(Boolean)) linhas.push({ linha: numero, celulas });
    if (linhas.length > MAX_LINHAS_TRIAGEM) {
      throw new ErroPlanilha(`A planilha tem mais de ${MAX_LINHAS_TRIAGEM} mercadorias. Divida-a em lotes menores.`);
    }
  });
  if (formulaDetectada) throw new ErroPlanilha("Copie e cole os valores das fórmulas antes de enviar a planilha.");
  if (!linhas.length) throw new ErroPlanilha("Não há mercadorias na planilha.");
  return { planilha: nome, aba: sheet.name, colunas, linhas };
}
