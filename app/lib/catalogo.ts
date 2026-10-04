// Rules and evidence shared by preparation and audit. No private client data is cached.
export type RegraCondicao = { operador: string; valor: string; composicao?: string; condicao?: RegraCondicao };
export type AtributoOficial = {
  codigo: string; nome: string; nomeApresentacao?: string; definicao?: string;
  orientacaoPreenchimento?: string; formaPreenchimento: string; tamanhoMaximo?: number;
  casasDecimais?: number; mascara?: string; dataInicioVigencia?: string; dataFimVigencia?: string;
  dominio?: { codigo: string; descricao: string; dataInicioVigencia?: string; dataFimVigencia?: string }[];
  objetivos?: { codigo: number; descricao: string }[]; orgaos?: string[];
  condicionados?: { obrigatorio: boolean; multivalorado?: boolean; dataInicioVigencia?: string; dataFimVigencia?: string; descricaoCondicao?: string; condicao: RegraCondicao; atributo: AtributoOficial }[];
  listaSubatributos?: AtributoOficial[];
};
export type Vinculo = { codigo: string; modalidade: string; obrigatorio: boolean; multivalorado?: boolean; dataInicioVigencia?: string; dataFimVigencia?: string };
export type BaseOficial = { versao: string; listaNcm: { codigoNcm: string; listaAtributos: Vinculo[] }[]; detalhesAtributos: AtributoOficial[] };
export type CampoCatalogo = AtributoOficial & { chave: string; obrigatorio: boolean; multivalorado: boolean; pai?: string; condicao?: RegraCondicao; descricaoCondicao?: string };
export type ValoresCatalogo = Record<string, string[]>;
export type EvidenciaCatalogo = { valor: string; fonte: string; trecho: string; conflito: string; revisado: boolean };
export type RegrasCatalogo = { ncm: string; versao: string; consultadoEm: string; dataReferencia: string; fonte: string; campos: CampoCatalogo[]; avisos: string[] };
export const FONTE_CATALOGO = 'https://portalunico.siscomex.gov.br/cadatributos/api/atributo-ncm/download/json';
export function normalizarNcmCatalogo(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!/^(\d{8}|\d{4}\.\d{2}\.\d{2})$/.test(raw)) throw new Error('Informe uma NCM com 8 dígitos.');
  return raw.replaceAll('.', '');
}
export function vigente(item: { dataInicioVigencia?: string; dataFimVigencia?: string }, data: string) {
  return (!item.dataInicioVigencia || item.dataInicioVigencia <= data) && (!item.dataFimVigencia || item.dataFimVigencia >= data);
}
export function regrasPorNcm(base: BaseOficial, ncmEntrada: unknown, data: string): RegrasCatalogo {
  const ncm = normalizarNcmCatalogo(ncmEntrada);
  const registro = base.listaNcm.find(item => item.codigoNcm.replaceAll('.', '') === ncm);
  if (!registro) throw new Error('NCM não encontrada na relação oficial. Confira o código e a nomenclatura vigente.');
  const detalhes = new Map(base.detalhesAtributos.map(item => [item.codigo, item]));
  const campos: CampoCatalogo[] = [], avisos: string[] = [];
  function adicionar(attr: AtributoOficial, vinculo: { obrigatorio: boolean; multivalorado?: boolean }, pai?: string, condicao?: RegraCondicao, descricaoCondicao?: string, depth = 0) {
    if (depth > 8) throw new Error('Hierarquia oficial de atributos excede o limite de leitura.');
    if (!vigente(attr, data)) return;
    const chave = pai ? `${pai}/${attr.codigo}` : attr.codigo;
    if (campos.some(c => c.chave === chave)) throw new Error('A base contém vínculos ambíguos. A consulta precisa de revisão.');
    campos.push({ ...attr, dominio: (attr.dominio ?? []).filter(d => vigente(d, data)), condicionados: [], listaSubatributos: [], chave, obrigatorio: vinculo.obrigatorio, multivalorado: !!vinculo.multivalorado, pai, condicao, descricaoCondicao });
    if (attr.formaPreenchimento === 'COMPOSTO') avisos.push(`${attr.codigo}: atributo composto; revisão manual da estrutura necessária nesta etapa.`);
    for (const filho of attr.condicionados ?? []) {
      if (vigente(filho, data)) adicionar(filho.atributo, filho, chave, filho.condicao, filho.descricaoCondicao, depth + 1);
    }
  }
  for (const v of registro.listaAtributos) {
    if (!['Importação', 'IMPORTACAO'].includes(v.modalidade) || !vigente(v, data)) continue;
    const attr = detalhes.get(v.codigo);
    if (!attr) throw new Error(`A definição oficial de ${v.codigo} não foi localizada. Tente atualizar a base.`);
    // Only product attributes belong to CATP; DUIMP/TA fields are intentionally excluded.
    if (!attr.objetivos?.some(o => o.codigo === 7 || o.descricao.toLowerCase() === 'produto')) continue;
    adicionar(attr, v);
  }
  return { ncm, versao: base.versao, dataReferencia: data, consultadoEm: new Date().toISOString(), fonte: FONTE_CATALOGO, campos, avisos };
}
export function avaliarCondicao(condicao: RegraCondicao, valores: string[]): boolean | null {
  if (!valores.length || !['==', '!='].includes(condicao.operador)) return null;
  let atual = condicao.operador === '==' ? valores.includes(condicao.valor) : valores.every(v => v !== condicao.valor);
  if (!condicao.condicao) return atual;
  const proxima = avaliarCondicao(condicao.condicao, valores);
  if (condicao.composicao === '||') return atual || proxima === true ? true : proxima === null ? null : false;
  if (condicao.composicao === '&&') return !atual || proxima === false ? false : proxima;
  return null;
}
export function aplicabilidade(campo: CampoCatalogo, campos: CampoCatalogo[], valores: ValoresCatalogo): boolean | null {
  if (!campo.pai) return true;
  const pai = campos.find(c => c.chave === campo.pai);
  if (!pai) return null;
  const aplicavel = aplicabilidade(pai, campos, valores);
  if (aplicavel !== true) return aplicavel;
  return campo.condicao ? avaliarCondicao(campo.condicao, valores[pai.chave] ?? []) : null;
}
export function validarValor(campo: CampoCatalogo, valores: string[]): string[] {
  const erros: string[] = [];
  if (!valores.length) return erros;
  if (!campo.multivalorado && valores.length > 1) erros.push('Este atributo aceita somente um valor.');
  if (valores.some(v => !v.trim())) erros.push('Há um valor vazio.');
  if (new Set(valores).size !== valores.length) erros.push('Há valores repetidos.');
  for (const valor of valores) {
    if (campo.tamanhoMaximo && valor.length > campo.tamanhoMaximo) erros.push(`Limite de ${campo.tamanhoMaximo} caracteres excedido.`);
    if (campo.formaPreenchimento === 'LISTA_ESTATICA' && !campo.dominio?.some(d => d.codigo === valor)) erros.push(`Código ${valor} fora do domínio oficial.`);
    if (campo.formaPreenchimento === 'BOOLEANO' && !['true', 'false'].includes(valor)) erros.push('Informe true ou false.');
    if (campo.formaPreenchimento === 'NUMERO_INTEIRO' && !/^-?\d+$/.test(valor)) erros.push('Informe um número inteiro.');
    if (campo.formaPreenchimento === 'NUMERO_REAL' && !/^-?\d+(\.\d+)?$/.test(valor)) erros.push('Informe número decimal com ponto.');
    if (campo.casasDecimais !== undefined && /^-?\d+(\.\d+)?$/.test(valor) && (valor.split('.')[1]?.length ?? 0) > campo.casasDecimais) erros.push(`Use até ${campo.casasDecimais} casas decimais.`);
    if (campo.formaPreenchimento === 'DATA' && (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor)) || new Date(valor).toISOString().slice(0, 10) !== valor)) erros.push('Informe uma data válida no formato AAAA-MM-DD.');
  }
  if (!['TEXTO', 'LISTA_ESTATICA', 'BOOLEANO', 'NUMERO_INTEIRO', 'NUMERO_REAL', 'DATA'].includes(campo.formaPreenchimento) || campo.mascara) erros.push('Regra especial de formato: validação manual necessária.');
  return [...new Set(erros)];
}
export function avaliarCadastro(regras: RegrasCatalogo, valores: ValoresCatalogo, evidencias: Record<string, EvidenciaCatalogo> = {}) {
  const campos = regras.campos.map(campo => {
    const ativa = aplicabilidade(campo, regras.campos, valores);
    const preenchidos = valores[campo.chave] ?? [];
    const erros = ativa === true ? validarValor(campo, preenchidos) : [];
    const estado = ativa === false ? 'nao_aplicavel' : ativa === null ? 'condicao_pendente' : erros.length ? 'invalido' : !preenchidos.length ? 'ausente' : evidencias[campo.chave]?.conflito ? 'conflito' : !evidencias[campo.chave]?.revisado ? 'revisar' : 'revisado';
    return { campo, ativa, valores: preenchidos, erros, estado };
  });
  const obrigatorios = campos.filter(c => c.ativa === true && c.campo.obrigatorio);
  const preenchidos = obrigatorios.filter(c => c.valores.length && !c.erros.length).length;
  const pendencias = campos.filter(c => c.estado === 'condicao_pendente' || c.estado === 'invalido' || c.estado === 'conflito' || (c.ativa === true && c.campo.obrigatorio && c.estado !== 'revisado'));
  return { campos, obrigatorios: obrigatorios.length, preenchidos, completude: obrigatorios.length ? Math.round(preenchidos * 100 / obrigatorios.length) : null, pendencias: pendencias.length };
}
function normalizarTrecho(s: string) { return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase(); }
export function verificarEvidencia(sugestao: { valor: string; fonte: string; trecho: string; conflito?: string }, fontes: { nome: string; texto: string }[]): EvidenciaCatalogo | null {
  const trecho = normalizarTrecho(sugestao.trecho);
  if (trecho.length < 12 || !sugestao.valor.trim()) return null;
  const fonte = fontes.find(f => f.nome === sugestao.fonte && normalizarTrecho(f.texto).includes(trecho));
  if (!fonte) return null;
  return { valor: sugestao.valor, fonte: fonte.nome, trecho: sugestao.trecho, conflito: sugestao.conflito ?? '', revisado: false };
}
export function importarProdutosJson(entrada: unknown): any[] {
  const lista = Array.isArray(entrada) ? entrada : (entrada as any)?.produtos;
  if (!Array.isArray(lista) || !lista.length || lista.length > 50) throw new Error('Envie uma lista JSON de 1 a 50 produtos, ou um objeto com a lista produtos.');
  return lista.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Cada produto deve ser um objeto JSON.');
    return p;
  });
}
export function valoresDoProduto(produto: any): ValoresCatalogo {
  const valores: ValoresCatalogo = {};
  for (const a of produto.atributos ?? []) {
    if (typeof a.codigo === 'string') (valores[a.codigo] ??= []).push(String(a.valor ?? ''));
  }
  for (const a of produto.atributosMultivalorados ?? []) {
    if (typeof a.codigo === 'string' && Array.isArray(a.valores)) valores[a.codigo] = a.valores.map(String);
  }
  return valores;
}
