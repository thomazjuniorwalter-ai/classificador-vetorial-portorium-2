"use client";
import { useState } from "react";

const bases = [["Brasil","NCM, NESH e RFB","Prioritária"],["Internacional","OMA, UE, EUA e Japão","Comparativa"],["Contencioso","CARF e precedentes","Complementar"]];

export default function Home() {
  const [tab,setTab]=useState("resultado"); const [loading,setLoading]=useState(false);
  const [files,setFiles]=useState<File[]>([]);
  const [result,setResult]=useState(""); const [error,setError]=useState("");
  const analisar=async()=>{setLoading(true);setError("");setResult("");try{const form=new FormData();form.append("descricao",(document.getElementById("descricao") as HTMLTextAreaElement)?.value||"");files.forEach(file=>form.append("documentos",file));const response=await fetch("/api/classificar",{method:"POST",body:form});const data=await response.json();if(!response.ok)throw new Error(data.error||"Não foi possível concluir a análise.");setResult(data.result);setTab("resultado")}catch(problem){setError(problem instanceof Error?problem.message:"Erro inesperado.")}finally{setLoading(false)}};
  const adicionar=(list:FileList|null)=>{if(!list)return;setFiles(current=>[...current,...Array.from(list).filter(file=>!current.some(item=>item.name===file.name&&item.size===file.size))])};
  const tamanho=(bytes:number)=>bytes<1024*1024?`${Math.max(1,Math.round(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
  return <main>
    <header className="topbar"><div className="brand"><div className="brandMark">P</div><div><strong>PORTORIUM</strong><span>CONSULTORIA INTERNACIONAL</span></div></div><div className="productName"><span>Classificador</span> Vetorial</div><button className="user">WT</button></header>
    <section className="workspace">
      <aside className="sidebar"><button className="newAnalysis" onClick={()=>setTab("resultado")}>＋ Nova análise</button><nav><a className="active">⌕ Analisar mercadoria</a><a>◷ Histórico</a><a>▤ Biblioteca vetorial</a></nav><div className="sourceTitle">BASES CONSULTADAS</div>{bases.map(([country,detail,kind])=><div className="source" key={country}><span className="sourceDot"/><div><strong>{country}</strong><small>{detail}</small><em>{kind}</em></div></div>)}<div className="security"><span>◆</span><p><strong>Ambiente protegido</strong>Documentos tratados com confidencialidade.</p></div></aside>
      <div className="content">
        <div className="intro"><div><span className="eyebrow">INTELIGÊNCIA APLICADA À CLASSIFICAÇÃO FISCAL</span><h1>Identifique. Fundamente.<br/><i>Decida com segurança.</i></h1></div><div className="corpus"><strong>+50 mil</strong><span>decisões e textos<br/>orientativos indexados</span></div></div>
        <section className="inputCard"><label>Descreva a mercadoria ou cole as informações técnicas</label><textarea id="descricao" defaultValue="" placeholder="Ex.: nome técnico, composição, função, funcionamento, marca, modelo e demais características conhecidas."/>
          <input id="documentos" className="fileInput" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={event=>{adicionar(event.target.files);event.target.value=""}}/>
          {files.length>0&&<div className="fileList"><div className="fileSummary"><strong>{files.length} {files.length===1?"documento selecionado":"documentos selecionados"}</strong><span>Prontos para a análise demonstrativa</span></div>{files.map((file,index)=><div className="fileItem" key={`${file.name}-${file.size}`}><span className="fileIcon">▤</span><p><strong>{file.name}</strong><small>{tamanho(file.size)}</small></p><button aria-label={`Remover ${file.name}`} onClick={()=>setFiles(current=>current.filter((_,position)=>position!==index))}>×</button></div>)}</div>}
          <div className="inputFooter"><label htmlFor="documentos" className="attach">＋ Anexar documentos</label><span>PDF, Word, Excel, texto ou imagens</span><button className="analyze" onClick={analisar} disabled={loading}>{loading?"Consultando bases…":files.length?`Analisar com ${files.length} ${files.length===1?"anexo":"anexos"} →`:"Analisar mercadoria →"}</button></div>
        </section>
        {error&&<div className="apiError"><strong>Não foi possível concluir</strong><span>{error}</span></div>}
        <div className="notice"><span>i</span><p><strong>Análise técnica assistida</strong>A classificação indicada deve ser validada por profissional responsável antes de sua utilização aduaneira.</p></div>
        {result?<section className="resultCard"><div className="resultHead"><div><span className="tag">RESULTADO DA PESQUISA VETORIAL</span><h2>Análise concluída</h2><p>Resposta gerada pelo Piloto Classificação Fiscal 2408</p></div><div className="confidence live"><span>ORIGEM</span><strong>OpenAI + bases vetoriais</strong></div></div>
          <div className="tabs"><button className="active">Resultado completo</button></div>
          {tab==="resultado"&&<div className="tabBody apiResult">{result}</div>}
        </section>:<section className="emptyResult"><span>⌕</span><h3>Aguardando uma mercadoria</h3><p>Informe as características ou anexe os documentos para iniciar a pesquisa nas bases de classificação fiscal.</p></section>}<footer>Classificador Vetorial Portorium · Tecnologia aplicada à conformidade aduaneira <span>Análise assistida</span></footer>
      </div>
    </section>
  </main>
}
