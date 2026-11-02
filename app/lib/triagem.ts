export const MAX_LINHAS_TRIAGEM = 50;
export const MAX_ARQUIVO_PLANILHA = 2 * 1024 * 1024;
export const LIMIAR_CONFIANCA_ALTA = 80;

export type SinalTriagem = "verde" | "amarelo" | "vermelho";

export type ColunaPlanilha = { indice: number; titulo: string };
export type LinhaPlanilha = { linha: number; celulas: Record<number, string> };

export function normalizarNcm(valor: unknown, completarZeroInicial = false): string | null {
  const original = String(valor ?? "").trim();
  if (!/^\d[\d.\-/\s]*$/.test(original)) return null;
  const digitos = original.replace(/\D/g, "");
  // O Excel pode retirar o zero inicial quando a NCM foi gravada como número.
  if (completarZeroInicial && digitos.length === 7) return `0${digitos}`;
  return digitos.length === 8 ? digitos : null;
}

export function ncmExibicao(ncm: string): string {
  return `${ncm.slice(0, 4)}.${ncm.slice(4, 6)}.${ncm.slice(6, 8)}`;
}

export function colunaDeClassificacao(titulo: string): boolean {
  const simples = titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\bncm\b|\bhs\s*code\b|classificacao\s*fiscal|codigo\s*tarifario/.test(simples);
}

export function descricaoMercadoria(
  linha: LinhaPlanilha,
  colunas: ColunaPlanilha[],
  indices: number[]
): string {
  return indices
    .map((indice) => {
      const coluna = colunas.find((item) => item.indice === indice);
      if (!coluna || colunaDeClassificacao(coluna.titulo)) return "";
      const valor = (linha.celulas[indice] || "").trim();
      return valor ? `${coluna.titulo}: ${valor}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 2_500);
}

export function sinalizarTriagem(
  ncmCliente: string,
  ncmSugerida: string,
  confianca: number,
  informacoesPendentes: string[] = []
): SinalTriagem {
  if (informacoesPendentes.length || !Number.isFinite(confianca)) return "amarelo";
  if (!normalizarNcm(ncmCliente, true)) return "amarelo";
  if (!normalizarNcm(ncmSugerida)) return "amarelo";
  if (confianca < LIMIAR_CONFIANCA_ALTA) return "amarelo";
  return normalizarNcm(ncmCliente, true) === normalizarNcm(ncmSugerida) ? "verde" : "vermelho";
}

export type DetalhesTriagem = {
  justificativa: string;
  informacoesPendentes: string[];
  fontes: string[];
};

export function validarDetalhesTriagem(valor: unknown): DetalhesTriagem {
  if (!valor || typeof valor !== "object") throw new Error("Detalhes da análise inválidos.");
  const item = valor as Record<string, unknown>;
  if (typeof item.justificativa !== "string" || !item.justificativa.trim() || item.justificativa.length > 4000 ||
      !Array.isArray(item.informacoesPendentes) || item.informacoesPendentes.length > 20 ||
      item.informacoesPendentes.some((x: unknown) => typeof x !== "string" || !x.trim() || x.length > 500) ||
      !Array.isArray(item.fontes) || item.fontes.length > 100 ||
      item.fontes.some((x: unknown) => typeof x !== "string" || !x.trim() || x.length > 2000)) {
    throw new Error("Detalhes da análise inválidos.");
  }
  return { justificativa: item.justificativa.trim(), informacoesPendentes: item.informacoesPendentes, fontes: item.fontes };
}
