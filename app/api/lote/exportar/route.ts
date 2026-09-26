import ExcelJS from "exceljs";
import { getPortalAccess, portalAccessResponse } from "../../../lib/auth";
import {
  MAX_LINHAS_TRIAGEM, normalizarNcm, ncmExibicao, sinalizarTriagem,
} from "../../../lib/triagem";

export const runtime = "nodejs";
export const maxDuration = 60;

type LinhaRecebida = {
  linha: number;
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
  ];
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE52B3B" } };
  sheet.autoFilter = { from: "A1", to: "F1" };

  for (const item of linhas) {
    const cliente = normalizarNcm(item.ncmCliente, true)!;
    const sugestao = normalizarNcm(item.ncmSugerida);
    const avaliada = item.confianca !== undefined && !item.erro;
    const sinal = avaliada ? sinalizarTriagem(cliente, sugestao || "", item.confianca!) : null;
    const linha = sheet.addRow({
      linha: item.linha,
      mercadoria: item.mercadoria.slice(0, 2_500),
      cliente: ncmExibicao(cliente),
      sugerida: sugestao ? ncmExibicao(sugestao) : "",
      confianca: avaliada ? item.confianca : "",
      sinal: sinal ? sinal.toUpperCase() : "NÃO ANALISADO",
    });
    linha.alignment = { vertical: "top", wrapText: true };
    linha.font = { name: "Arial", size: 11 };
    const cor = sinal === "verde" ? "FFDBF3E2" : sinal === "vermelho" ? "FFFCE0E3" : sinal === "amarelo" ? "FFFFF0C9" : "FFEDEEEF";
    linha.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor } };
    if (item.linha % 2 === 0) linha.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F5" } };
  }
  const bytes = await workbook.xlsx.writeBuffer();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="triagem-classificador-portorium.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
