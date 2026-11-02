import ExcelJS from "exceljs";
import { getPortalAccess, portalAccessResponse } from "../../../lib/auth";
import {
  MAX_LINHAS_TRIAGEM, normalizarNcm, ncmExibicao, sinalizarTriagem, validarDetalhesTriagem,
} from "../../../lib/triagem";

export const runtime = "nodejs";
export const maxDuration = 60;

type LinhaRecebida = {
  linha: number;
  codigoProduto?: string;
  justificativa?: string;
  informacoesPendentes?: string[];
  fontes?: string[];
  mercadoria: string;
  ncmCliente: string;
  ncmSugerida?: string;
  confianca?: number;
  erro?: string;
};

export async function POST(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);
  let linhas: LinhaRecebida[];
  try {
    const body = await request.json();
    if (!Array.isArray(body?.linhas) || body.linhas.length < 1 || body.linhas.length > MAX_LINHAS_TRIAGEM) {
      throw new Error("Quantidade inválida de mercadorias.");
    }
    linhas = body.linhas;
    for (const item of linhas) {
      if ((item?.confianca !== undefined && !item.erro) || item?.justificativa !== undefined || item?.informacoesPendentes !== undefined || item?.fontes !== undefined) validarDetalhesTriagem(item);
      if ((item?.codigoProduto !== undefined && (typeof item.codigoProduto !== "string" || item.codigoProduto.length > 350)) ||
          (item?.erro !== undefined && (typeof item.erro !== "string" || item.erro.length > 4000))) throw new Error("Dados inválidos.");
    }
    if (linhas.some((item) => !Number.isInteger(item?.linha) || item.linha < 2 ||
      typeof item.mercadoria !== "string" || item.mercadoria.length > 2_500 ||
      !normalizarNcm(item.ncmCliente, true) ||
      (item.ncmSugerida && !normalizarNcm(item.ncmSugerida)) ||
      (item.confianca !== undefined && (!Number.isInteger(item.confianca) || item.confianca < 0 || item.confianca > 100)))) {
      throw new Error("Uma das linhas contém dados inválidos.");
    }
  } catch {
    return Response.json({ error: "Dados inválidos para exportação." }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portorium";
  const sheet = workbook.addWorksheet("Triagem", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Linha original", key: "linha", width: 16 },
    { header: "Informações da mercadoria", key: "mercadoria", width: 55 },
    { header: "NCM do cliente", key: "cliente", width: 19 },
    { header: "NCM sugerida", key: "sugerida", width: 19 },
    { header: "Confiança estimada (%)", key: "confianca", width: 27 },
    { header: "Sinal de revisão", key: "sinal", width: 23 },
    { header: "Código do produto", key: "codigoProduto", width: 24 },
    { header: "Justificativa", key: "justificativa", width: 65 },
    { header: "Informações a solicitar", key: "pendencias", width: 55 },
    { header: "Fontes recuperadas na pesquisa", key: "fontes", width: 65 },
    { header: "Erro de processamento", key: "erro", width: 45 },
  ];
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE52B3B" } };
  sheet.autoFilter = { from: "A1", to: "K1" };

  for (const item of linhas) {
    const cliente = normalizarNcm(item.ncmCliente, true)!;
    const sugestao = normalizarNcm(item.ncmSugerida);
    const avaliada = item.confianca !== undefined && !item.erro;
    const sinal = avaliada ? sinalizarTriagem(cliente, sugestao || "", item.confianca!, item.informacoesPendentes) : null;
    const linha = sheet.addRow({
      linha: item.linha,
      codigoProduto: item.codigoProduto || "",
      justificativa: item.justificativa || "",
      pendencias: (item.informacoesPendentes || []).join("\n"),
      fontes: (item.fontes || []).join("\n"),
      erro: item.erro || "",
      mercadoria: item.mercadoria.slice(0, 2_500),
      cliente: ncmExibicao(cliente),
      sugerida: sugestao ? ncmExibicao(sugestao) : "",
      confianca: avaliada ? item.confianca : "",
      sinal: sinal ? sinal.toUpperCase() : item.erro ? "FALHA" : "NÃO ANALISADO",
    });
    linha.alignment = { vertical: "top", wrapText: true };
    linha.font = { name: "Arial", size: 11 };
    const cor = sinal === "verde" ? "FFDBF3E2" : sinal === "vermelho" ? "FFFCE0E3" : sinal === "amarelo" ? "FFFFF0C9" : "FFEDEEEF";
    linha.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor } };
    if (item.linha % 2 === 0) linha.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F5" } };
  }
  const legenda = workbook.addWorksheet("Como interpretar");
  legenda.columns = [{ header: "Orientação", key: "texto", width: 110 }];
  for (const texto of [
    "Verde: códigos coincidentes, confiança estimada de pelo menos 80% e sem pendências. Não garante classificação correta.",
    "Amarelo: informações pendentes, NCM não determinada ou confiança abaixo de 80%.",
    "Vermelho: códigos divergentes com confiança de pelo menos 80% e sem pendências. Requer revisão técnica.",
    "Confiança é estimativa do modelo, não probabilidade de acerto medida.",
    "Fontes recuperadas são documentos retornados na pesquisa. A recuperação não comprova aplicabilidade ou vigência.",
    "FALHA e NÃO ANALISADO não são resultados de classificação. Consulte o erro e retome as linhas pendentes.",
  ]) { legenda.addRow({ texto }).alignment = { wrapText: true, vertical: "top" }; }
  const bytes = await workbook.xlsx.writeBuffer();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="triagem-classificador-portorium.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
