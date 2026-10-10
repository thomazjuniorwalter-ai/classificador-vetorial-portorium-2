'use client';
import { useState } from 'react';
export default function CatalogoSiscomex({ onProdutos, disabled }: { onProdutos: (produtos: any[]) => Promise<void>; disabled: boolean }) {
  const [clientId, setClientId] = useState(''), [clientSecret, setClientSecret] = useState('');
  const [documento, setDocumento] = useState(''), [ncm, setNcm] = useState('');
  const [ambiente, setAmbiente] = useState('producao'), [busy, setBusy] = useState(false), [mensagem, setMensagem] = useState(''), [error, setError] = useState('');
  const [produtos, setProdutos] = useState<any[]>([]);
  async function consultar(event: React.FormEvent) {
    event.preventDefault(); if (busy || disabled) return;
    setBusy(true); setError(''); setMensagem(''); setProdutos([]);
    try {
      const pending = fetch('/api/catalogo/siscomex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret, cpfCnpjRaiz: documento, ncm, ambiente }) });
      setClientId(''); setClientSecret('');
      const response = await pending;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar o catálogo.');
      setProdutos(data.produtos);
      setMensagem(data.produtos.length ? `${data.produtos.length} produto(s) recebido(s).${data.parcial ? ' O Siscomex informou retorno parcial; esta consulta não representa o catálogo completo.' : ''}` : 'Nenhum produto encontrado para os filtros informados.');
    } catch (e) { setError((e as Error).message); }
    finally { setClientId(''); setClientSecret(''); setBusy(false); }
  }
  return <section className='catalogPanel'>
    <h2>Consultar meu catálogo no Siscomex</h2>
    <p>Consulte os produtos de importação e leve o resultado para auditoria. Esta conexão apenas consulta os cadastros.</p>
    <form onSubmit={consultar} autoComplete='off'>
      <div className='catalogConnectionGrid'>
        <label htmlFor='siscomex-ambiente'>Ambiente<select id='siscomex-ambiente' value={ambiente} disabled={busy || disabled} onChange={e => { setAmbiente(e.target.value); setProdutos([]); }}><option value='producao'>Produção</option><option value='validacao'>Treinamento / Validação</option></select></label>
        <label htmlFor='siscomex-documento'>CPF ou CNPJ raiz do catálogo<input id='siscomex-documento' placeholder='CPF (11) ou CNPJ raiz (8 dígitos)' inputMode='numeric' required value={documento} disabled={busy || disabled} onChange={e => { setDocumento(e.target.value); setProdutos([]); }} /></label>
        <label htmlFor='siscomex-client-id'>Identificador da chave · Client-Id<input id='siscomex-client-id' type='password' autoComplete='off' required value={clientId} disabled={busy || disabled} onChange={e => setClientId(e.target.value)} /></label>
        <label htmlFor='siscomex-client-secret'>Chave secreta · Client-Secret<input id='siscomex-client-secret' type='password' autoComplete='new-password' required value={clientSecret} disabled={busy || disabled} onChange={e => setClientSecret(e.target.value)} /></label>
        <label htmlFor='siscomex-filtro-ncm'>Filtrar por NCM (opcional)<input id='siscomex-filtro-ncm' value={ncm} disabled={busy || disabled} placeholder='0000.00.00' onChange={e => { setNcm(e.target.value); setProdutos([]); }} /></label>
      </div>
      <p className='catalogNotice'>Use as chaves do perfil IMPEXP. Elas são apagadas dos campos ao enviar a consulta e não são salvas pelo aplicativo. Consulte até 50 produtos; filtre por NCM para restringir o resultado.</p>
      <button className='analyze' disabled={busy || disabled} type='submit'>{busy ? 'Consultando Siscomex…' : 'Consultar produtos'}</button>
    </form>
    {error && <p className='catalogError' role='alert'>{error}</p>}
    {mensagem && <p className='catalogNotice' role='status'>{mensagem}</p>}
    {produtos.length > 0 && <><ul className='catalogProductList'>{produtos.map((p, i) => <li key={i}>{String(p.denominacao || p.codigo || 'Produto')} · NCM {String(p.ncm || '')} · versão {String(p.versao || '')}</li>)}</ul><button className='batchSecondary' disabled={busy || disabled} onClick={() => onProdutos(produtos)}>Auditar os produtos consultados</button></>}
  </section>;
}
