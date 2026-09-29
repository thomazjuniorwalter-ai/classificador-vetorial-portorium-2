"use client";

import { useState } from "react";

type Achado = {
  campo: string; item: string; prioridade: string; situacao: string;
  declarado: string; documento: string; evidenciaDraft: string;
  evidenciaDocumento: string; explicacao: string;
};
type Resultado = { resumo: string; documentosIdentificados: string[]; achados: Achado[]; pendencias: string[] };

export default function ConferidorDuimp() {
  const [draft, setDraft] = useState<File | null>(null);
  const [suportes, setSuportes] = useState<File[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [decisoes, setDecisoes] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [erro, setErro] = useState("");

  async function analisar() {
    if (!draft || !suportes.length || ocupado) return;
    const arquivos = [draft, ...suportes];
    if (arquivos.some((file) => file.type !== "application/pdf" || file.size > 10 * 1024 * 1024) ||
        arquivos.reduce((total, file) => total + file.size, 0) > 40 * 1024 * 1024) {
      setErro("Use PDFs de até 10 MB cada e 40 MB no conjunto."); return;
    }
    setOcupado(true); setErro(""); setResultado(null); setDecisoes({});
    const tokens: string[] = [];
    let analiseIniciada = false;
    try {
      for (let i = 0; i < arquivos.length; i += 1) {
        setProgresso(`Enviando ${i + 1} de ${arquivos.length}: ${arquivos[i].name}`);
        const form = new FormData(); form.append("arquivo", arquivos[i]); form.append("tipo", "duimp");
        const upload = await fetch("/api/arquivos", { method: "POST", body: form });
        const data = await upload.json();
        if (!upload.ok || !data.token) throw new Error(data.error || "Falha no envio de um PDF.");
        tokens.push(data.token);
      }
      setProgresso("Lendo os documentos e comparando os campos…");
      analiseIniciada = true;
      const response = await fetch("/api/conferidor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentos: tokens }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha na conferência.");
      setResultado(data.resultado);
    } catch (cause) {
      if (!analiseIniciada && tokens.length) void fetch("/api/arquivos", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens }),
      });
      setErro(cause instanceof Error ? cause.message : "Falha na conferência.");
    } finally { setOcupado(false); setProgresso(""); }
  }

  return <section className="duimpArea">
    <div className="batchIntro"><span className="eyebrow">PRÉ-CONFERÊNCIA DOCUMENTAL</span><h1>Conferidor de <i>DUIMP</i></h1>
      <p>Compare o draft com a fatura, o packing list e o conhecimento de transporte. Cada apontamento exige revisão do analista.</p></div>
    <div className="duimpUpload">
      <label>1 · Draft da DUIMP ou relatório de cálculo<input type="file" accept=".pdf,application/pdf" disabled={ocupado} onChange={(event) => { setDraft(event.target.files?.[0] || null); setResultado(null); }} /></label>
      <span>{draft?.name || "Selecione o PDF do draft"}</span>
      <label>2 · Documentos originais (até 3 PDFs)<input type="file" accept=".pdf,application/pdf" multiple disabled={ocupado} onChange={(event) => { setSuportes(Array.from(event.target.files || []).slice(0, 3)); setResultado(null); }} /></label>
      <span>{suportes.length ? suportes.map((file) => file.name).join(" · ") : "Fatura, packing list e BL; podem estar reunidos em um único PDF"}</span>
      <button type="button" onClick={analisar} disabled={!draft || !suportes.length || ocupado}>{ocupado ? progresso : "Conferir documentos"}</button>
      <small>PDFs de até 10 MB cada. Ao terminar a análise, a aplicação solicita a remoção dos arquivos enviados.</small>
    </div>
    {erro && <div className="apiError" role="alert">{erro}</div>}
    {resultado && <div className="duimpResults">
      <h2>Achados para revisão</h2><p>{resultado.resumo}</p>
      <p><strong>Documentos identificados:</strong> {resultado.documentosIdentificados.join("; ") || "Confirmar manualmente"}</p>
      {resultado.achados.length === 0 && <p>Nenhuma divergência foi apontada. Confira a legibilidade e os campos antes de concluir a revisão.</p>}
      {resultado.achados.map((achado, index) => <article key={index} className="duimpFinding">
        <div><span className={`duimpPriority ${achado.prioridade}`}>{achado.prioridade}</span><span>{achado.situacao.replaceAll("_", " ")}</span></div>
        <h3>{achado.item ? `${achado.item} · ` : ""}{achado.campo}</h3><p>{achado.explicacao}</p>
        <dl><div><dt>Draft</dt><dd>{achado.declarado || "Não localizado"}<small>{achado.evidenciaDraft}</small></dd></div>
          <div><dt>Documento</dt><dd>{achado.documento || "Não localizado"}<small>{achado.evidenciaDocumento}</small></dd></div></dl>
        <label>Decisão do analista <select value={decisoes[index] || ""} onChange={(event) => setDecisoes((current) => ({ ...current, [index]: event.target.value }))}>
          <option value="">Pendente de revisão</option><option value="confirmado">Confirmar achado</option>
          <option value="descartado">Descartar após conferência</option><option value="complementar">Solicitar documento</option>
        </select></label>
      </article>)}
      {resultado.pendencias.length > 0 && <div className="duimpPending"><strong>Informações pendentes</strong><ul>{resultado.pendencias.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      <p className="duimpNotice">Pré-conferência assistida. A leitura de PDFs digitalizados e o pareamento de itens podem falhar; valide as evidências antes de usar o resultado.</p>
    </div>}
  </section>;
}
