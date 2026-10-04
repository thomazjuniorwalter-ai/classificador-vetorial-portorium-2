// Server-only transport. Credentials and Portal tokens live only in this request.
export class ErroSiscomex extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}
export type ConsultaSiscomex = { clientId: string; clientSecret: string; cpfCnpjRaiz: string; ncm?: string; ambiente: 'producao' | 'validacao' };
export function validarConsultaSiscomex(value: any): ConsultaSiscomex {
  const chave = (v: unknown) => typeof v === 'string' && v.length >= 8 && v.length <= 2048 && /^[\x21-\x7e]+$/.test(v);
  if (!value || !chave(value.clientId) || !chave(value.clientSecret)) throw new ErroSiscomex('Informe o identificador e a chave secreta do Portal Único.', 400);
  const cpfCnpjRaiz = String(value.cpfCnpjRaiz ?? '').replace(/[.\-/\s]/g, '');
  if (!/^(\d{8}|\d{11})$/.test(cpfCnpjRaiz)) throw new ErroSiscomex('Informe o CPF do catálogo ou os 8 primeiros dígitos do CNPJ.', 400);
  const ncm = String(value.ncm ?? '').replaceAll('.', '').trim();
  if (ncm && !/^\d{8}$/.test(ncm)) throw new ErroSiscomex('Informe uma NCM com 8 dígitos ou deixe o filtro vazio.', 400);
  if (!['producao', 'validacao'].includes(value.ambiente)) throw new ErroSiscomex('Selecione o ambiente do catálogo.', 400);
  return { clientId: value.clientId, clientSecret: value.clientSecret, cpfCnpjRaiz, ncm, ambiente: value.ambiente };
}
async function lerJsonLimitado(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ErroSiscomex('O Portal retornou uma resposta vazia.');
  let size = 0; const partes: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new ErroSiscomex('O catálogo excede o limite deste teste. Filtre por NCM.', 413); }
      partes.push(value);
    }
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch (e) { if (e instanceof ErroSiscomex) throw e; throw new ErroSiscomex('A resposta do Portal não está no formato esperado.'); }
  finally { reader.releaseLock(); }
}
export async function consultarProdutosSiscomex(input: ConsultaSiscomex, transporte: typeof fetch = fetch) {
  const base = input.ambiente === 'producao' ? 'https://portalunico.siscomex.gov.br' : 'https://val.portalunico.siscomex.gov.br';
  const signal = AbortSignal.timeout(40000);
  const options = { cache: 'no-store' as const, redirect: 'error' as const, signal };
  const auth = await transporte(`${base}/portal/api/autenticar/chave-acesso`, { ...options, method: 'POST', headers: { 'Client-Id': input.clientId, 'Client-Secret': input.clientSecret, 'Role-Type': 'IMPEXP', Accept: 'application/json' } });
  if (!auth.ok) { await auth.body?.cancel(); throw new ErroSiscomex('O Siscomex não autenticou a chave. Confira validade, perfil IMPEXP e ambiente. Se acabou de autenticar, aguarde pelo menos 60 segundos antes de tentar novamente.', 422); }
  const token = auth.headers.get('Set-Token'), csrf = auth.headers.get('X-CSRF-Token');
  await auth.body?.cancel();
  if (!token || !csrf) throw new ErroSiscomex('O Siscomex não forneceu os tokens de consulta.');
  const params = new URLSearchParams({ cpfCnpjRaiz: input.cpfCnpjRaiz, modalidade: 'IMPORTACAO' });
  if (input.ncm) params.set('ncm', input.ncm);
  const response = await transporte(`${base}/catp/api/ext/produto?${params}`, { ...options, method: 'GET', headers: { Authorization: token, 'X-CSRF-Token': csrf, Accept: 'application/json' } });
  if (response.status === 204) return { produtos: [], parcial: false };
  if (!response.ok) {
    await response.body?.cancel();
    throw new ErroSiscomex(response.status === 403 ? 'Sua credencial não tem permissão para consultar esse catálogo no Siscomex.' : 'O Siscomex não concluiu a consulta. Confira o CPF/CNPJ do catálogo e tente novamente mais tarde.', response.status === 403 ? 403 : 502);
  }
  const produtos = await lerJsonLimitado(response);
  if (!Array.isArray(produtos) || produtos.some(p => !p || typeof p !== 'object' || Array.isArray(p))) throw new ErroSiscomex('O Portal retornou uma estrutura de produtos inesperada.');
  if (produtos.length > 50) throw new ErroSiscomex('A consulta trouxe mais de 50 produtos. Use uma NCM para limitar o primeiro teste.', 413);
  return { produtos, parcial: response.status === 206 };
}
