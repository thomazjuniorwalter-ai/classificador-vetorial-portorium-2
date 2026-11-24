import type { EcicsEvidenceSummary } from "../lib/ecics-presentation";

export type EcicsAvailability = {
  available: boolean;
  recordCount?: number;
  validCasCount?: number;
  exportedAt?: string | null;
};

const SOURCE_URL = "https://ec.europa.eu/taxation_customs/dds2/ecics/chemicalsubstance_consultation.jsp?Lang=en";
const dateLabel = (value: string) => new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function EcicsSource({ status }: { status: EcicsAvailability }) {
  return <div className="source ecicsSource"><span className="sourceDot" /><div>
    <strong>ECICS · substâncias químicas</strong>
    {status.available ? <>
      <small>{(status.recordCount || 0).toLocaleString("pt-BR")} registros · CAS e CN europeu</small>
      {status.exportedAt && <small>Extrato de {dateLabel(status.exportedAt)}</small>}
      <em>Referência comparativa · NCM validada separadamente</em>
    </> : <em>Base indisponível nesta consulta</em>}
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Fonte: Comissão Europeia ↗</a>
  </div></div>;
}

export default function EcicsEvidence({ evidence }: { evidence?: EcicsEvidenceSummary }) {
  if (!evidence || (evidence.status === "not_applicable" && !evidence.truncated && !evidence.queryTruncated)) return null;
  const found = evidence.status === "retrieved" && evidence.matches.length > 0;
  return <section className="ecicsEvidence" aria-label="Referências químicas ECICS">
    <div className="ecicsHeading"><div><span className="tag">REFERÊNCIA QUÍMICA · UNIÃO EUROPEIA</span><h3>ECICS — CAS e classificação europeia</h3></div>
      <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Consultar a fonte ↗</a>
    </div>
    {evidence.queriedCas.length > 0 && <p><strong>CAS pesquisados:</strong> {evidence.queriedCas.join(", ")}</p>}
    {evidence.invalidCas.length > 0 && <p className="ecicsNotice">Confira o formato e o dígito verificador: {evidence.invalidCas.join(", ")}. Esses identificadores não foram usados como CAS válidos.</p>}
    {evidence.status === "unavailable" ? <p>A base ECICS não pôde ser consultada nesta análise.</p>
      : found ? <>
        <p>{evidence.matches.length} {evidence.matches.length === 1 ? "registro recuperado" : "registros recuperados"}{evidence.matchMode === "name" ? " por nome exato na fonte" : " por correspondência exata de CAS"}.</p>
        {evidence.ambiguousCas.length > 0 && <p className="ecicsNotice">O mesmo CAS aparece em códigos CN diferentes. Compare composição, pureza e apresentação de cada registro antes de concluir.</p>}
        <div className="ecicsTableScroll"><table><caption>Registros recuperados do extrato ECICS</caption><thead><tr><th scope="col">Substância ou preparação</th><th scope="col">CAS / CUS</th><th scope="col">CN europeu</th><th scope="col">SH da referência</th></tr></thead><tbody>
          {evidence.matches.map(match => <tr key={match.cus}>
            <td>{match.chemicalName || match.iupacName}{match.chemicalName && match.iupacName && match.chemicalName !== match.iupacName && <small>IUPAC: {match.iupacName}</small>}</td>
            <td>{match.casNumbers.join(", ") || "CAS não informado"}<small>CUS {match.cus}</small></td>
            <td>{match.cnCode}</td><td>{match.hsCode || "Sem subposição de 6 dígitos"}</td>
          </tr>)}
        </tbody></table></div>
      </> : evidence.status !== "invalid_cas" && <p>Nenhuma correspondência exata foi recuperada no extrato consultado. Isso não comprova ausência da substância no ECICS.</p>}
    {(evidence.truncated || evidence.queryTruncated) && <p className="ecicsNotice">A consulta atingiu um limite de extensão ou de registros. As alternativas exibidas não são exaustivas; refine os dados da mercadoria.</p>}
    <p className="ecicsFootnote">{evidence.exportedAt && `Extrato de ${dateLabel(evidence.exportedAt)}. `}A CN europeia é uma referência comparativa. A coincidência do CAS não confirma composição ou pureza, e a NCM brasileira exige validação própria. A data do extrato não certifica vigência.</p>
  </section>;
}
