"use client";

import { useRef, useState } from "react";
import {
  colunaDeClassificacao, descricaoMercadoria, MAX_ARQUIVO_PLANILHA,
  MAX_LINHAS_TRIAGEM, ncmExibicao, normalizarNcm, sinalizarTriagem,
  type ColunaPlanilha, type LinhaPlanilha, type SinalTriagem,
} from "../lib/triagem";

type Planilha = { planilha: string; aba: string; colunas: ColunaPlanilha[]; linhas: LinhaPlanilha[] };
type Resultado = { ncm: string; confianca: number; sinal: SinalTriagem } | { erro: string };
type Item = { linha: number; descricao: string; ncmCliente: string };

const ROTULO: Record<SinalTriagem, string> = {
  verde: "Coincide · menor prioridade",
  amarelo: "Incerteza · revisar",
  vermelho: "Diverge · revisar primeiro",
};

function mensagemResposta(data: unknown, fallback: string): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error : fallback;
}

export default function TriagemLote({ onAprofundar }: { onAprofundar: (descricao: string) => void }) {
  const [planilha, setPlanilha] = useState<Planilha | null>(null);
  const [colunaNcm, setColunaNcm] = useState<number | "">("");
  const [colunasTecnicas, setColunasTecnicas] = useState<number[]>([]);
  const [resultados, setResultados] = useState<Record<number, Resultado>>({});
  const [importando, setImportando] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [finalizadas, setFinalizadas] = useState(0);
  const [erro, setErro] = useState("");
  const controlador = useRef<AbortController | null>(null);

  async function importar(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.size > MAX_ARQUIVO_PLANILHA) {
      setErro("A planilha deve ter no máximo 2 MB.");
      return;
    }
    setImportando(true); setErro(""); setPlanilha(null); setResultados({}); setFinalizadas(0);
    try {
      const form = new FormData(); form.append("planilha", arquivo);
      const response = await fetch("/api/lote/planilha", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(mensagemResposta(data, "Não foi possível ler a planilha."));
      const recebida = data as Planilha;
      const ncm = recebida.colunas.find((coluna) => colunaDeClassificacao(coluna.titulo));
      const elegiveis = recebida.colunas.filter((coluna) => coluna.indice !== ncm?.indice &&
        !colunaDeClassificacao(coluna.titulo));
      const provaveis = elegiveis.filter((coluna) =>
        /produto|mercador|descri|compos|func|aplica|material|tecnic|uso|modelo/i.test(coluna.titulo));
      setPlanilha(recebida);
      setColunaNcm(ncm?.indice ?? "");
      setColunasTecnicas((provaveis.length ? provaveis : elegiveis.slice(0, 1))
        .slice(0, 6).map((coluna) => coluna.indice));
    } catch (problema) {
      setErro(problema instanceof Error ? problema.message : "Erro ao importar a planilha.");
    } finally {
      setImportando(false);
    }
  }

  function alterarColunas(indices: number[]) {
    setColunasTecnicas(indices);
    setResultados({}); setFinalizadas(0); setErro("");
  }

  function preparar(): Item[] | null {
    if (!planilha || colunaNcm === "" || !colunasTecnicas.length) {
      setErro("Selecione a coluna da NCM e pelo menos uma coluna com informações da mercadoria.");
      return null;
    }
    const itens = planilha.linhas.map((linha) => ({
      linha: linha.linha,
      descricao: descricaoMercadoria(linha, planilha.colunas, colunasTecnicas.filter((indice) => indice !== colunaNcm)),
      ncmCliente: normalizarNcm(linha.celulas[colunaNcm], true) || "",
    }));
    const invalidos = itens.filter((item) => !item.ncmCliente || item.descricao.length < 10);
    if (invalidos.length) {
      setErro(`Corrija as linhas ${invalidos.slice(0, 5).map((item) => item.linha).join(", ")}${invalidos.length > 5 ? "…" : ""}: a NCM precisa ter oito algarismos e a mercadoria deve estar descrita. Nenhuma análise foi cobrada.`);
      return null;
    }
    return itens;
  }

  async function analisar() {
    if (analisando) return;
    const itens = preparar();
    if (!itens) return;
    const pendentes = itens.filter((item) => !resultados[item.linha] || "erro" in resultados[item.linha]);
    if (!pendentes.length) return;
    const controller = new AbortController();
    controlador.current = controller;
    setAnalisando(true); setErro(""); setFinalizadas(itens.length - pendentes.length);
    let proxima = 0;

    async function trabalhador() {
      while (proxima < pendentes.length && !controller.signal.aborted) {
        const item = pendentes[proxima++];
        try {
          // Somente dados técnicos seguem à OpenAI: a NCM do cliente não é enviada.
          const response = await fetch("/api/lote/classificar", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ descricao: item.descricao }), signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(mensagemResposta(data, "Falha na análise desta linha."));
          const ncm = normalizarNcm(data.ncm) || "";
          if (!Number.isInteger(data.confianca) || data.confianca < 0 || data.confianca > 100) {
            throw new Error("A confiança recebida é inválida.");
          }
          setResultados((atual) => ({ ...atual, [item.linha]: {
            ncm, confianca: data.confianca,
            sinal: sinalizarTriagem(item.ncmCliente, ncm, data.confianca),
          } }));
        } catch (problema) {
          if (controller.signal.aborted) break;
          setResultados((atual) => ({ ...atual, [item.linha]: {
            erro: problema instanceof Error ? problema.message : "Falha nesta linha.",
          } }));
        } finally {
          if (!controller.signal.aborted) setFinalizadas((total) => total + 1);
        }
      }
    }

    try {
      await Promise.all([trabalhador(), trabalhador()]);
      if (controller.signal.aborted) setErro("Triagem interrompida. Os resultados concluídos foram preservados.");
    } finally {
      controlador.current = null; setAnalisando(false);
    }
  }

  async function exportar() {
    const itens = preparar();
    if (!itens) return;
    setExportando(true); setErro("");
    try {
      const response = await fetch("/api/lote/exportar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linhas: itens.map((item) => {
          const resultado = resultados[item.linha];
          return { linha: item.linha, mercadoria: item.descricao, ncmCliente: item.ncmCliente,
            ...(resultado && "erro" in resultado ? { erro: resultado.erro } :
              resultado && "confianca" in resultado ? { ncmSugerida: resultado.ncm, confianca: resultado.confianca } : {}),
          };
        }) }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(mensagemResposta(data, "Não foi possível gerar o Excel."));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "triagem-classificador-portorium.xlsx";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (problema) {
      setErro(problema instanceof Error ? problema.message : "Erro ao exportar.");
    } finally {
      setExportando(false);
    }
  }

  const totais = Object.values(resultados).reduce((acc, item) => {
    if ("sinal" in item) acc[item.sinal] += 1;
    return acc;
  }, { verde: 0, amarelo: 0, vermelho: 0 });
  const concluidas = totais.verde + totais.amarelo + totais.vermelho;
  const falhas = Object.values(resultados).filter((item) => "erro" in item).length;

  return <div className="batchArea">
    <div className="batchIntro"><span className="eyebrow">PRÉ-ANÁLISE DE CLASSIFICAÇÕES</span>
      <h1>Triagem de mercadorias <i>em lote.</i></h1>
      <p>Envie uma planilha, escolha as colunas técnicas e compare cada NCM do cliente com uma pesquisa independente.</p>
    </div>
    <section className="batchUpload">
      <div><h2>1. Envie a planilha Excel</h2><p>Arquivo .xlsx, títulos na primeira linha, até {MAX_LINHAS_TRIAGEM} mercadorias e 2 MB.</p></div>
      <label className="batchUploadButton" htmlFor="planilhaLote">{importando ? "Lendo planilha…" : "Escolher arquivo .xlsx"}</label>
      <input id="planilhaLote" type="file" accept=".xlsx" disabled={importando || analisando}
        onChange={(event) => { void importar(event.target.files?.[0]); event.target.value = ""; }} />
    </section>
    {planilha && <section className="batchConfig">
      <h2>2. Confira as colunas</h2><p><strong>{planilha.planilha}</strong> · aba “{planilha.aba}” · {planilha.linhas.length} mercadorias</p>
      <div className="batchColumns"><div><label htmlFor="colunaNcm">NCM informada pelo cliente</label>
        <select id="colunaNcm" value={colunaNcm} disabled={analisando}
          onChange={(event) => { const proximaColuna = Number(event.target.value) || ""; setColunaNcm(proximaColuna); setColunasTecnicas((atual) => atual.filter((indice) => indice !== proximaColuna)); setResultados({}); setFinalizadas(0); setErro(""); }}>
          <option value="">Selecione a coluna</option>
          {planilha.colunas.map((coluna) => <option key={coluna.indice} value={coluna.indice}>{coluna.titulo}</option>)}
        </select></div>
        <fieldset disabled={analisando}><legend>Informações técnicas que serão pesquisadas (até 6 colunas)</legend>
          <div className="batchChecks">{planilha.colunas.filter((coluna) => coluna.indice !== colunaNcm && !colunaDeClassificacao(coluna.titulo))
            .map((coluna) => <label key={coluna.indice}><input type="checkbox" checked={colunasTecnicas.includes(coluna.indice)}
              onChange={(event) => alterarColunas(event.target.checked ? [...colunasTecnicas, coluna.indice].slice(0, 6) :
                colunasTecnicas.filter((indice) => indice !== coluna.indice))} /> {coluna.titulo}</label>)}</div>
        </fieldset></div>
      <p className="batchPrivacy">A NCM indicada pelo cliente fica fora da pesquisa. Ela só é comparada com a sugestão após a análise.</p>
      <div className="batchActions"><button type="button" className="analyze" disabled={analisando || importando} onClick={() => void analisar()}>
        {analisando ? `Analisando ${finalizadas} de ${planilha.linhas.length}…` : concluidas || falhas ? "Analisar linhas pendentes ou com falha" : `Iniciar triagem de ${planilha.linhas.length} mercadorias`}
      </button>{analisando && <button type="button" className="batchSecondary" onClick={() => controlador.current?.abort()}>Interromper</button>}
        {(concluidas > 0 || falhas > 0) && <button type="button" className="batchSecondary" disabled={exportando || analisando}
          onClick={() => void exportar()}>{exportando ? "Gerando Excel…" : "Baixar resultado em Excel"}</button>}</div>
      <p className="batchCost">Cada mercadoria analisada gera uma chamada à API e custo por utilização. Linhas com erro podem ser reenviadas sem refazer as concluídas.</p>
    </section>}
    {erro && <div className="apiError" role="alert"><strong>Atenção</strong><span>{erro}</span></div>}
    {planilha && (analisando || concluidas > 0 || falhas > 0) && <section className="batchResults">
      <div className="batchResultsHead"><div><h2>3. Visão geral</h2><p role="status">{finalizadas} de {planilha.linhas.length} processadas · {falhas} com falha</p></div>
        <div className="batchTotals"><span className="signal signalGreen">{totais.verde} verdes</span>
          <span className="signal signalYellow">{totais.amarelo} amarelos</span>
          <span className="signal signalRed">{totais.vermelho} vermelhos</span></div></div>
      <div className="batchTableScroll"><table className="batchTable"><thead><tr>
        <th>Linha</th><th>Mercadoria</th><th>NCM do cliente</th><th>Sugestão independente</th><th>Confiança estimada</th><th>Sinal</th><th>Próximo passo</th>
      </tr></thead><tbody>{planilha.linhas.map((linha) => {
        const descricao = descricaoMercadoria(linha, planilha.colunas, colunasTecnicas.filter((indice) => indice !== colunaNcm));
        const cliente = normalizarNcm(linha.celulas[colunaNcm as number], true);
        const resultado = resultados[linha.linha];
        return <tr key={linha.linha}><td>{linha.linha}</td><td className="batchProduct" title={descricao}>{descricao.replace(/\n/g, " · ")}</td>
          <td>{cliente ? ncmExibicao(cliente) : "—"}</td>
          <td>{resultado && "ncm" in resultado ? resultado.ncm ? ncmExibicao(resultado.ncm) : "Não determinada" : "—"}</td>
          <td>{resultado && "confianca" in resultado ? `${resultado.confianca}%` : "—"}</td>
          <td>{resultado && "sinal" in resultado ? <span className={`signal signal${resultado.sinal[0].toUpperCase()}${resultado.sinal.slice(1)}`}>{ROTULO[resultado.sinal]}</span> :
            resultado && "erro" in resultado ? <span title={resultado.erro}>Falhou · tente novamente</span> : "Aguardando"}</td>
          <td><button type="button" className="batchLink" onClick={() => onAprofundar(descricao)}>Aprofundar →</button></td>
        </tr>;
      })}</tbody></table></div>
    </section>}
    <div className="batchLegend"><strong>Como ler as cores</strong>
      <p><b>Verde:</b> NCMs iguais e confiança estimada de 80% ou mais. <b>Amarelo:</b> resultado incerto ou NCM não determinada. <b>Vermelho:</b> NCMs diferentes e confiança estimada de 80% ou mais.</p>
      <p>O percentual é uma estimativa produzida pelo modelo, não uma taxa de acerto medida. As cores servem para priorizar a revisão humana; nenhuma confirma ou rejeita juridicamente a NCM do cliente.</p>
    </div>
  </div>;
}
