// Log only known, static collector messages. Never expose response bodies, URLs,
// request headers, stacks or arbitrary error text from a remote source.
const messages = new Map([
  ['Fonte oficial indisponível', 'HTTP_UNAVAILABLE'],
  ['Fonte vazia', 'EMPTY_RESPONSE'],
  ['Resposta oficial excede limite', 'RESPONSE_TOO_LARGE'],
  ['Data oficial inválida', 'INVALID_OFFICIAL_DATE'],
  ['Ementa fora dos filtros oficiais', 'INVALID_ABSTRACT'],
  ['Receita: resposta sem contagem oficial', 'RECEITA_MISSING_COUNT'],
  ['Receita: linha fora dos filtros', 'RECEITA_INVALID_ROW'],
  ['Receita: resultados truncados', 'RECEITA_TRUNCATED_RESULTS'],
  ['Receita: filtro oficial indisponível', 'RECEITA_MISSING_FILTER'],
  ['Receita: janela excede limite de paginação', 'RECEITA_PAGINATION_LIMIT'],
  ['Receita: formulário indisponível', 'RECEITA_MISSING_FORM'],
  ['Receita: mais de 100 decisões no mesmo dia', 'RECEITA_DAILY_LIMIT'],
  ['Receita: filtros não respeitados', 'RECEITA_FILTER_MISMATCH'],
  ['DOU: resposta sem catálogo estruturado', 'DOU_MISSING_CATALOG'],
  ['DOU: contagem ou paginação não confirmada', 'DOU_INVALID_PAGINATION'],
  ['DOU: origem inválida', 'DOU_INVALID_ORIGIN'],
  ['DOU: autoridade ou texto não confirmado', 'DOU_UNCONFIRMED_ARTICLE'],
  ['DOU: data de decisão inválida', 'DOU_INVALID_DATE'],
  ['DOU: ementa incompleta', 'DOU_INCOMPLETE_ABSTRACT'],
  ['DOU: nenhuma ementa classificada confirmada', 'DOU_NO_CONFIRMED_ABSTRACT'],
  ['DOU: paginação não respeitada', 'DOU_PAGE_MISMATCH'],
  ['DOU: contagem mudou durante coleta', 'DOU_COUNT_CHANGED'],
  ['DOU: publicação repetida ou sem link', 'DOU_INVALID_PUBLICATION'],
  ['DOU: cursor de paginação ausente', 'DOU_MISSING_CURSOR'],
  ['DOU: coleta truncada', 'DOU_TRUNCATED_RESULTS'],
  ['DOU: metadados incompletos', 'DOU_INCOMPLETE_METADATA'],
  ['DOU: data fora da janela', 'DOU_DATE_OUTSIDE_WINDOW'],
  ['DOU: limite da coleta excedido', 'DOU_COLLECTION_LIMIT'],
]);
const networkCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'ENETUNREACH', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function describeFailure(reason) {
  const message=reason?.message,status=reason?.status;
  if (messages.has(message)) {
    const error = {code:messages.get(message),message};
    if (error.code === 'HTTP_UNAVAILABLE' && Number.isInteger(status)
      && status >= 100 && status <= 599) error.httpStatus=status;
    return error;
  }
  if (reason?.name === 'TimeoutError') return {code:'TIMEOUT',message:'Tempo limite da fonte oficial excedido'};
  if (reason?.name === 'AbortError') return {code:'ABORTED',message:'Consulta à fonte oficial interrompida'};
  for (const code of [reason?.code,reason?.cause?.code]) {
    if (networkCodes.has(code)) return {code,message:'Falha de conexão com a fonte oficial'};
  }
  if (reason?.name === 'SyntaxError') return {code:'INVALID_RESPONSE',message:'Resposta oficial não pôde ser interpretada'};
  if (message === 'fetch failed') return {code:'FETCH_FAILED',message:'Consulta à fonte oficial falhou'};
  return {code:'UNEXPECTED_COLLECTOR_ERROR',message:'Falha não identificada no coletor; conteúdo do erro omitido'};
}

export function collectionFailureDiagnostics(results, {window} = {}) {
  const validWindow=window && typeof window.from==='string' && typeof window.to==='string' && /^\d{4}-\d{2}-\d{2}$/.test(window.from)
    && /^\d{4}-\d{2}-\d{2}$/.test(window.to) ? {from:window.from,to:window.to} : undefined;
  return ['receita','dou'].flatMap((source,index) => {
    const result=results[index];
    if (result?.status !== 'rejected') return [];
    return [{event:'cosit_source_failure',source,...(validWindow ? {window:validWindow} : {}),
      error:describeFailure(result.reason)}];
  });
}

export function logCollectionFailures(results, options, log = console.error) {
  for (const diagnostic of collectionFailureDiagnostics(results,options)) log(JSON.stringify(diagnostic));
}
