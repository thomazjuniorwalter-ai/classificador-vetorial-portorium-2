'use client';
import { useState } from 'react';
import styles from './catalogo-produtos.module.css';
import CatalogoSiscomex from './catalogo-siscomex';
import { avaliarCadastro, type RegrasCatalogo, type ValoresCatalogo, type EvidenciaCatalogo, type CampoCatalogo } from '../lib/catalogo';
type Evidencias = Record<string, EvidenciaCatalogo>;
type Auditoria = { versaoBase: string; auditadoEm: string; resultados: { nome: string; ncm: string; status: string; achados: string[]; completude?: number | null; regras?: RegrasCatalogo; valores?: ValoresCatalogo; descricao?: string }[] };
const estados: Record<string, string> = { ausente: 'Não informado', revisar: 'A revisar', revisado: 'Revisado', invalido: 'Valor incompatível', conflito: 'Conflito', condicao_pendente: 'Condição pendente', nao_aplicavel: 'Não aplicável' };
function baixar(nome: string, texto: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([texto], { type }));
  const link = document.createElement('a'); link.href = url; link.download = nome; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function resposta(response: Response) {
  let data: any;
  try { data = await response.json(); } catch { throw new Error('O serviço não respondeu como esperado. Tente novamente.'); }
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}
function CampoEditor({ campo, valores, disabled, onChange }: { campo: CampoCatalogo; valores: string[]; disabled: boolean; onChange: (valores: string[]) => void }) {
  const id = `catalogo-${campo.chave.replaceAll('/', '-')}`;
  const tipo = campo.formaPreenchimento;
  if (tipo === 'LISTA_ESTATICA') return <select id={id} aria-label={campo.nomeApresentacao || campo.nome} multiple={campo.multivalorado} size={campo.multivalorado ? Math.min(5, Math.max(2, campo.dominio?.length ?? 2)) : undefined} disabled={disabled} value={campo.multivalorado ? valores : valores[0] ?? ''} onChange={e => onChange(campo.multivalorado ? Array.from(e.target.selectedOptions, item => item.value) : e.target.value ? [e.target.value] : [])}>{!campo.multivalorado && <option value=''>Selecione somente se conhecido</option>}{campo.dominio?.map(d => <option key={d.codigo} value={d.codigo}>{d.codigo} · {d.descricao}</option>)}</select>;
  if (tipo === 'BOOLEANO' && !campo.multivalorado) return <select id={id} disabled={disabled} value={valores[0] ?? ''} onChange={e => onChange(e.target.value ? [e.target.value] : [])}><option value=''>Não informado</option><option value='true'>Sim</option><option value='false'>Não</option></select>;
  if (!['TEXTO', 'BOOLEANO', 'NUMERO_INTEIRO', 'NUMERO_REAL', 'DATA'].includes(tipo)) return <p className='catalogNotice'>Estrutura {tipo.toLowerCase().replaceAll('_', ' ')}: mantenha pendente para revisão manual.</p>;
  return <input id={id} disabled={disabled} type={!campo.multivalorado && tipo === 'DATA' ? 'date' : 'text'} inputMode={tipo.startsWith('NUMERO') ? 'decimal' : undefined} value={valores.join(' | ')} placeholder={campo.multivalorado ? 'Separe os valores por |' : 'Informe somente um valor conhecido'} onChange={e => onChange(e.target.value.trim() ? (campo.multivalorado ? e.target.value.split('|').map(v => v.trim()) : [e.target.value]) : [])} />;
}
export default function CatalogoProdutos({ initialNcm = '', initialDescricao = '', analyst }: { initialNcm?: string; initialDescricao?: string; analyst: string }) {
  const [modo, setModo] = useState<'preparar' | 'auditar' | 'consultar'>('preparar');
  const [ncm, setNcm] = useState(initialNcm), [descricao, setDescricao] = useState(initialDescricao);
  const [denominacao, setDenominacao] = useState(''), [descricaoCadastro, setDescricaoCadastro] = useState('');
  const [confirmada, setConfirmada] = useState(false), [regras, setRegras] = useState<RegrasCatalogo | null>(null);
  const [valores, setValores] = useState<ValoresCatalogo>({}), [evidencias, setEvidencias] = useState<Evidencias>({});
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(''), [error, setError] = useState(''), [aviso, setAviso] = useState('');
  const [auditoria, setAuditoria] = useState<Auditoria | null>(null);
  const avaliacao = regras ? avaliarCadastro(regras, valores, evidencias) : null;
  function limparRegras() { setRegras(null); setValores({}); setEvidencias({}); setConfirmada(false); setAviso(''); }
  async function consultar() {
    if (busy) return;
    setBusy('Consultando os atributos oficiais…'); setError(''); setAviso(''); setRegras(null); setValores({}); setEvidencias({});
    try { setRegras(await resposta(await fetch(`/api/catalogo/atributos?ncm=${encodeURIComponent(ncm)}`))); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function preparar() {
    if (busy || !regras || !confirmada) return;
    setBusy('Preparando a leitura…'); setError(''); setAviso('');
    const tokens: string[] = []; let enviado = false;
    try {
      for (const file of files) {
        setBusy(`Enviando ${file.name}…`);
        const form = new FormData(); form.append('arquivo', file);
        const upload = await resposta(await fetch('/api/arquivos', { method: 'POST', body: form })); tokens.push(upload.token);
      }
      setBusy('Buscando evidências para os atributos…'); enviado = true;
      const data = await resposta(await fetch('/api/catalogo/preparar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ncm, descricao, documentos: tokens, valores }) }));
      setRegras(data.regras);
      setEvidencias(old => ({ ...old, ...data.evidencias }));
      setValores(old => ({ ...old, ...Object.fromEntries(Object.entries(data.evidencias as Evidencias).map(([chave, e]) => [chave, [e.valor]])) }));
      setAviso(data.aviso || 'Sugestões disponíveis para revisão. Campos sem evidência permanecem vazios.');
    } catch (e) { setError((e as Error).message); }
    finally {
      if (!enviado && tokens.length) await fetch('/api/arquivos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens }) }).catch(() => undefined);
      setBusy('');
    }
  }
  function editar(chave: string, value: string[]) {
    setValores(old => ({ ...old, [chave]: value }));
    setEvidencias(old => ({ ...old, [chave]: { valor: value.join(' | '), fonte: '', trecho: '', conflito: '', revisado: false } }));
  }
  function adicionar(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.some(f => f.size > 10 * 1024 * 1024 || !/\.(pdf|doc|docx|txt|md)$/i.test(f.name))) { setError('Use PDF, Word ou texto, com até 10 MB por documento.'); return; }
    const next = [...files, ...incoming.filter(f => !files.some(old => old.name === f.name && old.size === f.size))];
    if (next.length > 10 || next.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024) { setError('Use até 10 documentos e 50 MB no conjunto.'); return; }
    setFiles(next); setError('');
  }
  async function auditar(file: File | undefined) {
    if (!file || busy) return;
    if (file.size > 2 * 1024 * 1024 || !/\.(json|xlsx)$/i.test(file.name)) { setError('Envie JSON ou Excel (.xlsx) com até 2 MB e 50 produtos.'); return; }
    setBusy('Conferindo os cadastros com a base oficial…'); setError(''); setAuditoria(null);
    try {
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const form = new FormData(); form.append('arquivo', file);
        setAuditoria(await resposta(await fetch('/api/catalogo/auditar', { method: 'POST', body: form })));
      } else {
        const texto = await file.text(); JSON.parse(texto);
        setAuditoria(await resposta(await fetch('/api/catalogo/auditar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: texto })));
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  function exportar() {
    if (!regras || !avaliacao) return;
    baixar(`catalogo-revisao-${regras.ncm}.json`, JSON.stringify({ tipo: 'REVISAO_PORTORIUM_NAO_TRANSMITIDA', analista: analyst, geradoEm: new Date().toISOString(), ncmConfirmada: confirmada, denominacao, descricao: descricaoCadastro, regras, valores, evidencias, avaliacao }, null, 2));
  }
  function perguntas() {
    if (!avaliacao) return;
    const pendentes = avaliacao.campos.filter(c => c.ativa === true && (c.estado === 'ausente' || c.estado === 'condicao_pendente' || c.estado === 'invalido' || c.estado === 'conflito'));
    baixar(`pendencias-catalogo-${regras!.ncm}.txt`, `PORTORIUM — INFORMAÇÕES PARA O CATÁLOGO\nNCM selecionada: ${regras!.ncm}\n\n` + pendentes.map((c, i) => `${i + 1}. Informar ou confirmar ${c.campo.nomeApresentacao || c.campo.nome} (${c.campo.codigo}).\n${c.campo.orientacaoPreenchimento || ''}\n${c.campo.descricaoCondicao ? 'Condição: ' + c.campo.descricaoCondicao : ''}\nApresentar documento técnico que sustente a informação.\n${c.erros.join(' ')}`).join('\n\n'), 'text/plain;charset=utf-8');
  }
  return <section className={`${styles.shell} catalogArea`} aria-busy={!!busy}>
    <header className={styles.header}><div><span className='eyebrow'>PORTORIUM · CATÁLOGO DE PRODUTOS</span><h1>Seu cadastro, com mais clareza.</h1><p>Prepare um produto, revise um arquivo ou consulte seu catálogo no Siscomex.</p></div><span className={styles.headerBadge}>Atributos oficiais da NCM</span></header>
    <div className='catalogTabs' role='group' aria-label='Funções do catálogo'>
      {([{id:'preparar',numero:'01',titulo:'Preparar produto',detalhe:'NCM, dados e evidências'},{id:'auditar',numero:'02',titulo:'Auditar arquivo',detalhe:'Conferir JSON ou Excel'},{id:'consultar',numero:'03',titulo:'Meu catálogo Siscomex',detalhe:'Consultar produtos cadastrados'}] as const).map(item=><button key={item.id} type='button' disabled={!!busy} aria-pressed={modo===item.id} className={modo===item.id?'selected':''} onClick={()=>{setModo(item.id);setError('');}}><span className={styles.modeNumber}>{item.numero}</span><span><strong>{item.titulo}</strong><small>{item.detalhe}</small></span><span aria-hidden='true' className={styles.modeArrow}>↗</span></button>)}
    </div>
    <div hidden={modo!=='consultar'}>
    <CatalogoSiscomex disabled={!!busy} onProdutos={async produtos => {
      setBusy('Auditando os produtos consultados…'); setError(''); setAuditoria(null);
      try { setAuditoria(await resposta(await fetch('/api/catalogo/auditar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(produtos) }))); setModo('auditar'); }
      catch (e) { setError((e as Error).message); } finally { setBusy(''); }
    }} />
    </div>
    {error && <div className='apiError' role='alert'><strong>Não foi possível concluir</strong><span>{error}</span></div>}
    {busy && <p className='catalogNotice' role='status'>{busy}</p>}
    {modo === 'preparar' ? <>
      <section className='catalogPanel'><div className={styles.sectionHeading}><span>1</span><div><h2>Comece pela NCM</h2><p>Consulte os atributos exigidos para o produto.</p></div></div><div className='catalogRow'><label htmlFor='catalogo-ncm'>NCM selecionada<input id='catalogo-ncm' value={ncm} disabled={!!busy} placeholder='0000.00.00' onChange={e => { setNcm(e.target.value); limparRegras(); }} /></label><button className='analyze' disabled={!!busy || !ncm.trim()} onClick={consultar}>Consultar atributos</button></div>
      <p className='catalogNotice'>A NCM é uma informação a revisar. Este módulo não confirma a classificação fiscal nem determina o tratamento administrativo da operação.</p>
      <label className='catalogCheck'><input type='checkbox' checked={confirmada} disabled={!!busy} onChange={e => setConfirmada(e.target.checked)} />Revisei a NCM e quero utilizá-la na preparação deste cadastro.</label>
      </section><section className='catalogPanel'><div className={styles.sectionHeading}><span>2</span><div><h2>Identifique o produto</h2><p>Preencha a denominação e a descrição que acompanharão o cadastro.</p></div></div>
      <div className='catalogTwo'><label htmlFor='catalogo-denominacao'>Denominação do produto<input id='catalogo-denominacao' placeholder='Ex.: Bomba centrífuga, modelo ABC' value={denominacao} maxLength={120} disabled={!!busy} onChange={e => setDenominacao(e.target.value)} /></label><label htmlFor='catalogo-descricao-cadastro'>Descrição complementar<textarea id='catalogo-descricao-cadastro' placeholder='Características, composição, função e modelo do produto' value={descricaoCadastro} maxLength={3700} disabled={!!busy} onChange={e => setDescricaoCadastro(e.target.value)} /></label></div>
      </section><section className='catalogPanel'><div className={styles.sectionHeading}><span>3</span><div><h2>Reúna as evidências técnicas</h2><p>Use informações do fabricante ou documentos para sugerir os valores dos atributos.</p></div></div>
      <label htmlFor='catalogo-evidencia'>Informações técnicas para buscar evidências<textarea id='catalogo-evidencia' value={descricao} maxLength={20000} disabled={!!busy} placeholder='Cole as informações originais do fabricante ou do cliente. Inclua valores, unidades e identificação do modelo.' onChange={e => setDescricao(e.target.value)} /></label>
      <label className='catalogFile'>Documentos técnicos<input type='file' multiple disabled={!!busy} accept='.pdf,.doc,.docx,.txt,.md' onChange={e => { adicionar(e.target.files); e.target.value = ''; }} /></label><small>Até 10 documentos de 10 MB · máximo de 50 MB no conjunto</small>
      {files.length > 0 && <ul className='catalogFiles'>{files.map((file, i) => <li key={`${file.name}-${i}`}><span>{file.name}</span><button disabled={!!busy} aria-label={`Remover ${file.name}`} onClick={() => setFiles(old => old.filter((_, n) => n !== i))}>Remover</button></li>)}</ul>}
      {!regras || !confirmada ? <p className={styles.helper}>Para buscar sugestões, consulte os atributos e confirme a NCM na etapa 1.</p> : !descricao.trim() && !files.length ? <p className={styles.helper}>Adicione informações técnicas ou um documento para buscar sugestões.</p> : null}
      <button className='analyze' disabled={!!busy || !regras || !confirmada || (!descricao.trim() && !files.length)} onClick={preparar}>Sugerir valores com evidências</button>
      </section>
      {regras && avaliacao && <>
        <section className='catalogPanel'><div className='catalogSummary'><div><strong>Obrigatórios preenchidos</strong><b>{avaliacao.completude === null ? 'Sem obrigatórios ativos' : `${avaliacao.completude}%`}</b><small>{avaliacao.preenchidos} de {avaliacao.obrigatorios} campos · {avaliacao.pendencias} pendência(s) de revisão</small></div><p>Preenchimento não representa acerto da NCM ou aprovação do Siscomex.</p></div><p className='catalogSource'>Base de produção · versão {regras.versao} · referência {regras.dataReferencia} · <a href={regras.fonte} target='_blank' rel='noreferrer'>Fonte oficial</a></p>{aviso && <p role='status' className='catalogNotice'>{aviso}</p>}{regras.avisos.map(a => <p className='catalogNotice' key={a}>{a}</p>)}{!regras.campos.length && <p>Não foram localizados atributos com objetivo Produto para esta NCM na data de referência. A descrição e os demais dados do cadastro continuam exigindo revisão.</p>}</section>
        {avaliacao.campos.some(c => c.ativa === null) && <p className='catalogNotice'>Preencha os campos condicionantes para revelar os demais atributos aplicáveis. Condições ainda não resolvidas permanecem pendentes.</p>}<div className='catalogFields'>{avaliacao.campos.filter(c => c.ativa === true).map(c => {
          const campo = c.campo, ev = evidencias[campo.chave];
          return <article className='catalogField' key={campo.chave}><div className='catalogFieldHead'><label htmlFor={`catalogo-${campo.chave.replaceAll('/', '-')}`}><strong>{campo.nomeApresentacao || campo.nome}</strong><small>{campo.codigo} · {campo.orgaos?.join(', ')} · {campo.obrigatorio ? 'Obrigatório' : 'Opcional'}{campo.multivalorado ? ' · Múltiplos valores' : ''}</small></label><span className={`catalogStatus ${c.estado === 'revisado' ? 'reviewed' : ''}`}>{estados[c.estado]}</span></div>{campo.orientacaoPreenchimento && <p>{campo.orientacaoPreenchimento}</p>}{campo.descricaoCondicao && <p className='catalogNotice'>Condição: {campo.descricaoCondicao}</p>}<CampoEditor campo={campo} valores={c.valores} disabled={!!busy || c.ativa === null} onChange={value => editar(campo.chave, value)} />{c.erros.map(e => <p role='alert' className='catalogError' key={e}>{e}</p>)}{ev?.fonte && <div className='catalogEvidence'><strong>Origem: {ev.fonte}</strong>{ev.trecho && <blockquote>{ev.trecho}</blockquote>}{ev.trecho && ev.fonte !== "Informações fornecidas" && <small>Página não disponível na recuperação. Confira o documento original.</small>}</div>}{ev?.conflito && <p className='catalogError'>{ev.conflito}</p>}{c.valores.length > 0 && <label className='catalogCheck'><input type='checkbox' checked={!!ev?.revisado} disabled={!!busy || c.ativa !== true || c.erros.length > 0 || !!ev?.conflito} onChange={e => setEvidencias(old => ({ ...old, [campo.chave]: { valor: c.valores.join(' | '), fonte: ev?.fonte || 'Informação revisada pelo analista', trecho: ev?.trecho || '', conflito: ev?.conflito || '', revisado: e.target.checked } }))} />Revisei o valor e sua correspondência com o produto.</label>}</article>;
        })}</div><div className='catalogActions'><button className='batchSecondary' disabled={!!busy} onClick={exportar}>Baixar cadastro para revisão</button><button className='batchSecondary' disabled={!!busy} onClick={perguntas}>Baixar perguntas e pendências</button></div>
      </>}
    </> : modo === 'auditar' ? <section className='catalogPanel'><h2>Auditoria dos atributos cadastrados</h2><p>Envie até 50 produtos em JSON ou Excel (.xlsx), com até 2 MB. A conferência identifica campos obrigatórios ausentes, códigos incompatíveis e condições pendentes. Não reclassifica os produtos.</p><label className='catalogFile'>Selecionar arquivo<input type='file' accept='.json,.xlsx' disabled={!!busy} onChange={e => { void auditar(e.target.files?.[0]); e.target.value = ''; }} /></label><p className='catalogNotice'>Excel: títulos NCM, Denominação, Descrição e os códigos oficiais ATT_…; use | entre múltiplos valores. JSON: lista de produtos com atributos e atributosMultivalorados.</p><button className='batchSecondary' disabled={!!busy} onClick={() => baixar('modelo-auditoria-catalogo.json', JSON.stringify([{ ncm: '', denominacao: '', descricao: '', modalidade: 'IMPORTACAO', atributos: [], atributosMultivalorados: [] }], null, 2))}>Baixar modelo JSON</button>
    {auditoria && <div className='catalogAudit'><p className='catalogSource'>{auditoria.resultados.length} produto(s) · base oficial {auditoria.versaoBase}</p><button className='batchSecondary' onClick={() => baixar('auditoria-catalogo-portorium.json', JSON.stringify(auditoria, null, 2))}>Baixar auditoria</button>{auditoria.resultados.map((r, i) => <article className='catalogField' key={i}><div className='catalogFieldHead'><strong>{r.nome}</strong><span className='catalogStatus'>{r.status === 'erro' ? 'Não analisado' : r.status === 'pendencias' ? 'Pendências' : 'Revisão técnica necessária'}</span></div><p>NCM {r.ncm}{r.completude !== undefined && r.completude !== null ? ` · Obrigatórios preenchidos: ${r.completude}%` : ''}</p>{r.achados.length ? <ul>{r.achados.map((a, n) => <li key={n}>{a}</li>)}</ul> : <p>Não foram identificadas incompatibilidades nas regras verificadas. Confira descrição, evidências e classificação fiscal.</p>}{r.status !== 'erro' && <button className='batchSecondary' disabled={!!busy} onClick={async () => {
 setBusy('Carregando campos para revisão…'); setError('');
 try { const novasRegras = await resposta(await fetch(`/api/catalogo/atributos?ncm=${encodeURIComponent(r.ncm)}`)); setNcm(r.ncm); setRegras(novasRegras); setValores(r.valores!); setEvidencias({}); setDenominacao(r.nome); setDescricaoCadastro(r.descricao ?? ''); setDescricao(''); setFiles([]); setConfirmada(false); setModo('preparar'); setAviso('Valores importados do arquivo. Revise as fontes antes de confirmar os campos.'); }
 catch (e) { setError((e as Error).message); } finally { setBusy(''); }
 }}>Revisar este produto</button>}</article>)}</div>}
    </section> : null}
    <p className='catalogDisclaimer'>Preparação e auditoria assistidas. Os arquivos baixados são documentos de revisão Portorium. O cadastro não é transmitido ao Siscomex nesta etapa. Os dados desta sessão não são salvos no aplicativo; baixe o resultado antes de sair.</p>
  </section>;
}
