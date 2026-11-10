'use client';
import { useEffect, useState } from 'react';
type Status = {abstracts:number;collectedAt:string;refreshStatus?:string;stale?:boolean;sourceStatus?:{receita:string;dou:string};sourceChecks?:Record<string,{lastSuccessAt?:string}>;conflicts?:number;persistenceStatus?:string};
export default function CositStatus({initial}:{initial:Status}) {
  const [status,setStatus]=useState(initial);
  const [checking,setChecking]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/cosit/status',{signal:controller.signal}).then(async response=>{
      if(!response.ok) throw new Error('Consulta indisponível');
      const data=await response.json();
      if(typeof data.abstracts!=='number'||typeof data.collectedAt!=='string') throw new Error('Estado inválido');
      setStatus(data);
    }).catch(()=>{if(!controller.signal.aborted)setStatus(previous=>({...previous,refreshStatus:'fallback'}));})
      .finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return ()=>controller.abort();
  },[]);
  const sources=status.sourceStatus;
  const sourceDate=(source:string)=>status.sourceChecks?.[source]?.lastSuccessAt;
  const dateLabel=(date:string)=>new Date(date).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const sourceLabel=(source:'receita'|'dou')=>`${source==='receita'?'Receita':'DOU'} ${sources?.[source]==='available'?'disponível':sources?.[source]==='partial'?'com coleta parcial':'indisponível nesta consulta'}`;
  return <div className='source'><span className='sourceDot'/><div><strong>Ementas oficiais Cosit</strong>
    <small>{status.abstracts} ementas · coleta {new Date(status.collectedAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small>
    <em>{checking?'Consultando atualização…':status.refreshStatus==='fallback'||status.stale?'Última coleta disponível; atualização não confirmada':'Disponíveis como fonte complementar'}</em>
    <small>Cobertura histórica parcial · vigência não verificada</small>
    {!!status.conflicts&&<small>{status.conflicts} atos com divergência entre fontes; exigem verificação</small>}
    {(['receita','dou'] as const).map(source=>sourceDate(source)&&<small key={source}>Última verificação {source==='receita'?'Receita':'DOU'}: {dateLabel(sourceDate(source)!)}</small>)}
    {sources&&<small>{sourceLabel('receita')} · {sourceLabel('dou')}</small>}
  </div></div>;
}
