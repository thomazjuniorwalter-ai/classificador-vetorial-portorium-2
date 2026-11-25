// Read-only probe of public DOU pages. No secrets, ledger reads/writes or AI calls.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {collectDou, DOU_SOURCE, plainText} from '../app/lib/cosit-abstracts.ts';
import {collectionWindow} from '../app/lib/cosit-window.ts';
import {collectionFailureDiagnostics} from './cosit-diagnostics.mjs';

export function validationWindows(from = '', to = '', today = new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit',
}).format(new Date())) {
  const windows = !from && !to ? [
    {from:'2026-09-26', to:'2026-10-09'},
    {from:'2026-11-07', to:'2026-11-11'},
  ] : [{from, to}];
  return windows.map(window => {
    if (!window.from || !window.to) throw Error('Informe as duas datas ou deixe ambas vazias.');
    const checked = collectionWindow(today, window);
    if (Date.parse(checked.to) - Date.parse(checked.from) > 13 * 86400000) {
      throw Error('A validação aceita no máximo 14 dias por janela.');
    }
    return checked;
  });
}

export function searchEvidence(page) {
  const payload = page.match(/<script\b[^>]*id=["']_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
  let payloadState = 'missing', itemsCount = null;
  if (payload !== undefined) {
    try {
      const data = JSON.parse(payload);
      payloadState = Array.isArray(data?.jsonArray) ? 'array' : 'missing_items_array';
      if (Array.isArray(data?.jsonArray)) itemsCount = data.jsonArray.length;
    } catch { payloadState = 'invalid_json'; }
  }
  const request = page.match(/var request\s*=\s*\{([\s\S]*?)\}/)?.[1];
  const pagination = Object.fromEntries(['currentPage','totalPages'].map(field => [field,
    [...(request ?? '').matchAll(new RegExp(`(?:^|,)\\s*${field}\\s*:\\s*([^,]*)`, 'g'))].slice(0, 4)
      .map(match => { const value = match[1].trim(); return value.length <= 32 && /^[0-9eE+\-."' ]*$/.test(value) ? value : '[non-numeric]'; }),
  ]));
  const text = plainText(page.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:div|section|article|p|li|h[1-6]|tr|td)\b[^>]*>/gi, ' '));
  const counters = [...text.matchAll(/\bExibindo\s+(\d+)\s*[-\u2013\u2014]\s*(\d+)\s+de\s+(\d+)\s+resultados?\b/gi)]
    .slice(0, 4).map(match => match.slice(1).map(value => value.length <= 12 ? value : '[too-large]'));
  return {payloadState, itemsCount, requestFound:request !== undefined, pagination, counters,
    emptyMessage:/\bNenhum resultado (?:foi )?encontrado\b|\bNão foram encontrados resultados\b/i.test(text),
    blockedMessage:/\bAccess Denied\b|\bAcesso (?:negado|bloqueado)\b|\bcaptcha\b|\bService Unavailable\b/i.test(text)};
}

export async function runValidation({from = '', to = '', today, transport = fetch} = {}) {
  const windows = validationWindows(from, to, today);
  const results = [];
  let requests = 0;
  for (const window of windows) {
    const responses = [];
    const probe = async (input, init) => {
      const url = new URL(input);
      const search = url.origin + url.pathname === DOU_SOURCE;
      if (url.origin !== 'https://www.in.gov.br' || (!search && !/^\/(?:en\/)?web\/dou\/-\//.test(url.pathname))) {
        throw Error('DOU: origem inválida');
      }
      if (++requests > 30) throw Error('DOU: limite da coleta excedido');
      const response = await transport(input, init);
      const capture = {kind:search ? 'search' : 'article', httpStatus:response.status};
      responses.push(capture);
      if (!search || !response.ok || !response.body) return response;
      const reader = response.body.getReader(), chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw Error('Resposta oficial excede limite'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const page = Buffer.concat(chunks).toString('utf8');
      Object.assign(capture, {bytes, ...searchEvidence(page)});
      // Only bounded, allowlisted structural evidence enters the report. The
      // original body is returned to the real parser, never saved as an artifact.
      return new Response(page, {status:response.status});
    };
    try {
      const records = await collectDou(window.from, window.to, probe);
      results.push({window, status:'available', acts:records.length, responses});
    } catch (reason) {
      const error = collectionFailureDiagnostics([{status:'fulfilled', value:[]}, {status:'rejected', reason}], {window})[0].error;
      results.push({window, status:'unavailable', error, responses});
    }
  }
  return {schemaVersion:1, mode:'read_only_validation', source:'dou',
    status:results.every(result => result.status === 'available') ? 'complete' : 'partial_or_failed',
    requests, results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let report;
  try { report = await runValidation({from:process.env.COSIT_FROM || '', to:process.env.COSIT_TO || ''}); }
  catch { report = {schemaVersion:1, mode:'read_only_validation', status:'failed', error:'INVALID_WINDOW'}; }
  await fs.mkdir('.cosit-validation', {recursive:true});
  await fs.writeFile('.cosit-validation/report.json', JSON.stringify(report, null, 2) + '\n', {mode:0o600});
  console.log(JSON.stringify(report));
  if (report.status !== 'complete') process.exitCode = 1;
}
