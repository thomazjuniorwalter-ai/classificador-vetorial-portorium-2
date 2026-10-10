'use client';
import { useEffect, useState } from 'react';
type Status = {abstracts:number;collectedAt:string;refreshStatus?:string;stale?:boolean;sourceStatus?:{receita:string;dou:string}};
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
  return <div className='source'><span className='sourceDot'/><div><strong>Ementas oficiais Cosit</strong>
    <small>{status.abstracts} ementas · coleta {new Date(status.collectedAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small>
    <em>{checking?'Consultando atualização…':status.refreshStatus==='fallback'||status.stale?'Última coleta disponível; atualização não confirmada':'Disponíveis como fonte complementar'}</em>
    {sources&&<small>{sources.receita==='available'?'Receita disponível':'Receita indisponível'} · {sources.dou==='available'?'DOU disponível':'DOU indisponível nesta consulta'}</small>}
  </div></div>;
}
