/** Small, serializable ECICS evidence retained with a classification result. */
export type EcicsEvidenceSummary = {
  status: string;
  queriedCas: string[];
  invalidCas: string[];
  exportedAt: string;
  xlsxSha256: string;
  matchMode: string;
  totalMatches: number;
  truncated: boolean;
  queryTruncated: boolean;
  ambiguousCas: string[];
  matches: {
    cus: string;
    casNumbers: string[];
    cnCode: string;
    hsCode: string | null;
    chemicalName: string;
    iupacName: string;
  }[];
};

type RetrievalResult = {
  status: string;
  queriedCas: string[];
  invalidCas: string[];
  metadata: {
    exportedAt?: string | null;
    xlsxSha256?: string;
    matchMode: string;
    totalMatches: number;
    truncated: boolean;
    queryTruncated?: boolean;
    ambiguousCas?: string[];
  };
  matches: EcicsEvidenceSummary["matches"];
};

export function ecicsEvidenceSummary(result: RetrievalResult): EcicsEvidenceSummary {
  return {
    status: result.status,
    queriedCas: result.queriedCas,
    invalidCas: result.invalidCas,
    exportedAt: result.metadata.exportedAt || "",
    xlsxSha256: result.metadata.xlsxSha256 || "",
    matchMode: result.metadata.matchMode,
    totalMatches: result.metadata.totalMatches,
    truncated: result.metadata.truncated,
    queryTruncated: result.metadata.queryTruncated || false,
    ambiguousCas: result.metadata.ambiguousCas || [],
    matches: result.matches.map(({ cus, casNumbers, cnCode, hsCode, chemicalName, iupacName }) =>
      ({ cus, casNumbers, cnCode, hsCode, chemicalName, iupacName })),
  };
}

export function ecicsReportLines(evidence?: EcicsEvidenceSummary): string[] {
  if (!evidence || (evidence.status === "not_applicable" && !evidence.truncated && !evidence.queryTruncated)) return [];
  const lines = ["Referência química ECICS — Comissão Europeia / DG TAXUD."];
  if (evidence.exportedAt) lines.push("Exportação da base: " + evidence.exportedAt + "; edição da CN e vigência não informadas no extrato.");
  if (evidence.xlsxSha256) lines.push("SHA-256 do arquivo ECICS: " + evidence.xlsxSha256);
  if (evidence.queriedCas.length) lines.push("CAS pesquisados: " + evidence.queriedCas.join(", "));
  if (evidence.invalidCas.length) lines.push("Identificadores CAS não validados: " + evidence.invalidCas.join(", "));
  if (evidence.status === "unavailable") lines.push("A base ECICS estava indisponível nesta execução; nenhuma ausência de substância foi inferida.");
  else if (evidence.status === "invalid_cas") lines.push("O identificador informado não passou na validação CAS; confirme o número na ficha técnica.");
  else if (!evidence.matches.length) lines.push("Nenhuma correspondência exata foi recuperada no extrato consultado. Isso não comprova ausência da substância no ECICS.");
  for (const match of evidence.matches) {
    lines.push(`CUS ${match.cus} · CAS ${match.casNumbers.join(", ") || "não informado"} · CN europeu ${match.cnCode} · SH da referência ${match.hsCode || "não detalhado até seis dígitos"} · ${match.chemicalName || match.iupacName}`);
    if (match.chemicalName && match.iupacName && match.chemicalName !== match.iupacName) lines.push("Nome IUPAC: " + match.iupacName);
  }
  if (evidence.ambiguousCas.length) lines.push("CAS associados a códigos CN diferentes: " + evidence.ambiguousCas.join(", ") + ". Conferir as descrições e condições de cada registro.");
  if (evidence.truncated || evidence.queryTruncated) lines.push("Consulta limitada em extensão ou quantidade de registros; as alternativas mostradas não são exaustivas.");
  lines.push("CN europeu e NCM brasileira são campos distintos. A correspondência CAS ou nominal não confirma identidade integral, pureza, composição ou enquadramento fiscal. A NCM exige validação pelas regras e fontes brasileiras.");
  return lines;
}

/** Validate optional browser-returned evidence before including it in an export. */
export function validateEcicsEvidenceSummary(value: unknown): EcicsEvidenceSummary | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw new Error("Referências ECICS inválidas para exportação."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  const text = (input: unknown, max: number): string => {
    if (typeof input !== "string" || input.length > max) return fail();
    return input;
  };
  const validCas = (cas: string) => {
    if (!/^[1-9]\d{1,6}-\d{2}-\d$/.test(cas)) return false;
    const digits = cas.replace(/-/g, "");
    return [...digits.slice(0, -1)].reverse().reduce((sum, digit, i) => sum + Number(digit) * (i + 1), 0) % 10 === Number(digits.at(-1));
  };
  const strings = (input: unknown, maxItems: number, maxLength: number, isCas = false): string[] => {
    if (!Array.isArray(input) || input.length > maxItems) return fail();
    return input.map(entry => {
      const result = text(entry, maxLength);
      if (!result || (isCas && !validCas(result))) return fail();
      return result;
    });
  };
  if (!['retrieved', 'no_matches', 'invalid_cas', 'not_applicable', 'unavailable'].includes(String(item.status))
    || !['cas', 'name', 'none'].includes(String(item.matchMode))
    || typeof item.truncated !== "boolean" || typeof item.queryTruncated !== "boolean"
    || !Number.isSafeInteger(item.totalMatches) || Number(item.totalMatches) < 0 || Number(item.totalMatches) > 1_000_000
    || !Array.isArray(item.matches) || item.matches.length > 20) return fail();
  const exportedAt = text(item.exportedAt, 64);
  if (exportedAt && (!/^\d{4}-\d{2}-\d{2}T/.test(exportedAt) || !Number.isFinite(Date.parse(exportedAt)))) return fail();
  const xlsxSha256 = text(item.xlsxSha256, 64);
  if (xlsxSha256 && !/^[a-f0-9]{64}$/i.test(xlsxSha256)) return fail();
  const matches: EcicsEvidenceSummary["matches"] = item.matches.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail();
    const match = entry as Record<string, unknown>;
    const cus = text(match.cus, 9);
    const cnCode = text(match.cnCode, 8);
    if (!/^\d{7}-\d$/.test(cus) || !/^(?:\d{2}|\d{4}|\d{6}|\d{8})$/.test(cnCode)) return fail();
    const hsCode = cnCode.length >= 6 ? cnCode.slice(0, 6) : null;
    if (match.hsCode !== hsCode) return fail();
    const chemicalName = text(match.chemicalName, 8_000);
    const iupacName = text(match.iupacName, 8_000);
    if (!chemicalName && !iupacName) return fail();
    return {cus, casNumbers: strings(match.casNumbers, 32, 12, true), cnCode, hsCode, chemicalName, iupacName};
  });
  if (new Set(matches.map(match => match.cus)).size !== matches.length
    || Number(item.totalMatches) < matches.length
    || (item.status === 'retrieved' ? !matches.length : matches.length > 0)) return fail();
  const result: EcicsEvidenceSummary = {
    status: String(item.status), queriedCas: strings(item.queriedCas, 32, 12, true),
    invalidCas: strings(item.invalidCas, 5_000, 24), exportedAt, xlsxSha256,
    matchMode: String(item.matchMode), totalMatches: Number(item.totalMatches),
    truncated: item.truncated, queryTruncated: item.queryTruncated,
    ambiguousCas: strings(item.ambiguousCas, 32, 12, true), matches,
  };
  // Bound the additional payload without weakening existing batch/field limits.
  if (JSON.stringify(result).length > 96_000) return fail();
  return result;
}
