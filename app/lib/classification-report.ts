export type ClassificationResult = {
  classificacao: string; ncm: string; confianca: number;
  descricaoAduaneira: string; justificativa: string; informacoesPendentes: string;
};

export type ClassificationReport = {
  result: ClassificationResult;
  description: string;
  filenames: string[];
  analyzedAt: string;
  analyst: string;
  responseId?: string;
  retrievedSources?: string[];
};

export const REPORT_TITLE = "Parecer técnico preliminar de classificação fiscal";
export const REPORT_NOTICE = "Parecer técnico preliminar gerado com assistência de inteligência artificial, limitado aos dados fornecidos e trechos recuperados. Pode conter erros, omissões ou referências desatualizadas. Não constitui decisão vinculante da Receita Federal, resposta a consulta formal, garantia de enquadramento ou segurança jurídica. Não substitui parecer profissional assinado. Antes do uso em operações ou declarações, profissional responsável deve validar os dados técnicos, a fundamentação e a legislação vigente. A confiança é estimativa qualitativa, não probabilidade certificada. Os campos de revisão exigem validação efetiva; o sistema não atribui assinatura profissional.";

export function classificationReportSections(report: ClassificationReport) {
  const { result } = report;
  return [
    { title: "1. Identificação e objeto", content: [
      "Solicitante da análise: " + report.analyst,
      "Data: " + new Date(report.analyzedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)",
      ...(report.responseId ? ["Identificador da análise: " + report.responseId] : []),
      "Objeto: examinar o enquadramento fiscal da mercadoria descrita, com as ressalvas registradas neste parecer.",
    ] },
    { title: "2. Relatório e elementos técnicos", content: [report.description || "Descrição não preenchida; análise baseada nos documentos anexados.",
      "Documentos apresentados:", ...(report.filenames.length ? report.filenames.map(name => "- " + name) : ["Nenhum documento anexado."]) ] },
    { title: "3. Fundamentação técnica e normativa", content: [result.justificativa || "Não informada."] },
    { title: "4. Rastreabilidade da pesquisa", content: [
      "Arquivos retornados pela pesquisa normativa desta execução (a recuperação, por si só, não comprova aplicabilidade, integralidade ou vigência):",
      ...(report.retrievedSources?.length ? report.retrievedSources.map(name => "- " + name) : ["Nenhum nome de arquivo foi registrado no retorno da pesquisa. Isso não comprova ausência de normas na base; a fundamentação necessita conferência."]),
      "Trechos não recuperados devem ser tratados como limitação desta análise, e não como prova de que os documentos não integram a base.",
    ] },
    { title: "5. Conclusão preliminar", content: [
      "NCM sugerida: " + (result.ncm || "Não determinada"),
      result.classificacao || "Conclusão não informada.",
      "Confiança estimada pelo modelo: " + result.confianca + "% (estimativa qualitativa).",
      "Conclusão sujeita às ressalvas, pendências e validação profissional abaixo.",
    ] },
    { title: "6. Descrição aduaneira sugerida para o Catálogo de Produtos", content: [result.descricaoAduaneira || "Não informada."] },
    { title: "7. Ressalvas e diligências pendentes", content: [result.informacoesPendentes || "Nenhuma pendência indicada pelo modelo; permanece necessária a validação humana."] },
    { title: "8. Disclaimer e responsabilidade pela validação", content: [REPORT_NOTICE,
      "Profissional responsável pela revisão: __________________________",
      "Data da revisão e assinatura: _________________________________",
    ] },
  ];
}

export function saveReportBlob(blob: Blob, format: "pdf" | "docx", report: ClassificationReport) {
  const date = report.analyzedAt.slice(0, 10);
  const ncm = report.result.ncm.replace(/[^0-9]/g, "") || "sem_ncm";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `Portorium_Parecer_${ncm}_${date}.${format}`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
