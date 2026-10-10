import { createHash } from 'node:crypto';

export const RECEITA_SOURCE = 'https://atosdecisorios.receita.fazenda.gov.br/consultaweb/index.jsf';
export const DOU_SOURCE = 'https://www.in.gov.br/consulta/-/buscar/dou';
export type CositAbstract = {
  id: string; authority: string; type: string; number: string; decisionDate: string;
  sourceUrl: string; sourceUrls?: string[]; abstract: string; sha256: string;
  ncm: string[]; integrity: string; jurisdiction: string; sourceRecordId?: string;
  hasRelationshipSignals?: boolean; conflictingSources?: boolean;
};
export type CositCatalog = {
  records: CositAbstract[]; lastSuccessfulCollectionAt: string;
  sourceStatus: { receita: string; dou: string }; refreshStatus: string;
};
export function plainText(value: string) {
  const named: Record<string, string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ordm:'º',ordf:'ª',deg:'°'};
  return value.replace(/<br\s*\/?>|<\/br>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity: string) => {
      if (entity.startsWith('#')) { const n = parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all; }
      return named[entity.toLowerCase()] ?? all;
    }).trim();
}
function dateIso(value: string) {
  const [d,m,y] = value.split('/'); const iso = `${y}-${m}-${d}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || new Date(iso).toISOString().slice(0,10) !== iso) throw new Error('Data oficial inválida');
  return iso;
}
function record(kind: string, number: string, date: string, abstract: string, sourceUrl: string): CositAbstract {
  if (!['Solução de Consulta','Solução de Divergência'].includes(kind) || !/^\d+$/.test(number)
    || !/Classificação de Mercadorias/i.test(abstract) || abstract.length > 20000) throw new Error('Ementa fora dos filtros oficiais');
  return {id:`BR-COSIT-${kind === 'Solução de Consulta' ? 'SC' : 'SD'}-${number}-${date.slice(0,4)}`,
    authority:'Cosit',type:kind,number,decisionDate:date,sourceUrl,sourceUrls:[sourceUrl],abstract,
    sha256:createHash('sha256').update(abstract).digest('hex'),ncm:[...new Set(abstract.match(/\b\d{4}\.\d{2}\.\d{2}\b/g) ?? [])],
    integrity:'abstract',jurisdiction:'BR',hasRelationshipSignals:/revog|reform|anul|retific|diverg/i.test(abstract)};
}
export function parseReceita(page: string) {
  const count = page.match(/Total de atos localizados:\s*(\d+)/);
  if (!count) throw new Error('Receita: resposta sem contagem oficial');
  const total = Number(count[1]); const records: CositAbstract[] = [];
  const body = page.match(/<tbody[^>]*id="formPrincipal:list_data"[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  for (const row of body.matchAll(/<tr\b[^>]*data-rk="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c=>plainText(c[1]));
    if (cells.length !== 5 || cells[1] !== 'Cosit') throw new Error('Receita: linha fora dos filtros');
    records.push({...record(cells[0],cells[2],dateIso(cells[3]),cells[4],RECEITA_SOURCE),sourceRecordId:row[1]});
  }
  if (records.length > total || (total <= 100 && records.length !== total)) throw new Error('Receita: resultados truncados');
  return {total, records};
}
function choice(page: string, field: string, label: string) {
  const inputs = new Map([...page.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*value="([^"]+)"/g)].map(m=>[m[1],plainText(m[2])]));
  for (const m of page.matchAll(/<label\b[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)) {
    if (m[1].startsWith(`formPrincipal:${field}:`) && plainText(m[2]).startsWith(label) && inputs.has(m[1])) return inputs.get(m[1])!;
  }
  throw new Error('Receita: filtro oficial indisponível');
}
async function readPage(response: Response) {
  if (!response.ok) throw new Error('Fonte oficial indisponível');
  const reader = response.body?.getReader(); if (!reader) throw new Error('Fonte vazia');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if(size > 4*1024*1024) {await reader.cancel(); throw new Error('Resposta oficial excede limite');} chunks.push(item.value); } }
  finally {reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
}
export async function collectReceita(first: string, last: string, transport: typeof fetch = fetch) {
  const signal = AbortSignal.timeout(35000); let calls = 0;
  async function collect(a: string, b: string, kind: string): Promise<CositAbstract[]> {
    if (++calls > 20) throw new Error('Receita: janela excede limite de paginação');
    const initial = await transport(RECEITA_SOURCE,{cache:'no-store',signal,redirect:'error'});
    const cookies = initial.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const page = await readPage(initial);
    const view = page.match(/name="javax.faces.ViewState"[^>]*value="([^"]+)"/)?.[1];
    if (!view) throw new Error('Receita: formulário indisponível');
    const format = (iso: string)=>iso.split('-').reverse().join('/');
    const params = new URLSearchParams({'formPrincipal':'formPrincipal','javax.faces.ViewState':plainText(view),
      'formPrincipal:inpTextoPesquisavel':'','formPrincipal:selectUnidade':choice(page,'selectUnidade','Cosit'),
      'formPrincipal:selectTipoAto':choice(page,'selectTipoAto',kind),'formPrincipal:selectAssunto':choice(page,'selectAssunto','Classificação de Mercadorias'),
      'formPrincipal:dataAtoInicial_input':format(a),'formPrincipal:dataAtoFinal_input':format(b),'formPrincipal:btnPesq':'Pesquisar'});
    const response = await transport(RECEITA_SOURCE,{method:'POST',cache:'no-store',redirect:'error',signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded',...(cookies ? {Cookie:cookies}: {})},body:params.toString()});
    const {total,records} = parseReceita(await readPage(response));
    if (total > 100) {
      if (a === b) throw new Error('Receita: mais de 100 decisões no mesmo dia');
      const middle = new Date(Math.floor((Date.parse(a)+Date.parse(b))/2/86400000)*86400000).toISOString().slice(0,10);
      const next = new Date(Date.parse(middle)+86400000).toISOString().slice(0,10);
      return [...await collect(a,middle,kind),...await collect(next,b,kind)];
    }
    if (records.some(r=>r.decisionDate<a || r.decisionDate>b || r.type!==kind)) throw new Error('Receita: filtros não respeitados');
    return records;
  }
  const rows = await Promise.all(['Solução de Consulta','Solução de Divergência'].map(kind=>collect(first,last,kind)));
  return rows.flat();
}

export function parseDouSearch(page: string) {
  // These fields are supplied by the official search page, not snippets from a search engine.
  const payload = page.match(/<script\b[^>]*id=["']_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!payload) throw new Error('DOU: resposta sem catálogo estruturado');
  const data = JSON.parse(payload);
  const request = page.match(/var request\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const pages = request.match(/totalPages\s*:\s*(\d+)/)?.[1];
  const currentPage = request.match(/currentPage\s*:\s*(\d+)/)?.[1];
  const count = page.match(/Exibindo\s+(\d+)\s*-\s*(\d+)\s+de\s+(\d+)\s+resultados/i);
  if (!Array.isArray(data.jsonArray) || !pages || !currentPage || !count || Number(pages)>6 || Number(count[3])>450
    || data.jsonArray.length !== Number(count[2])-Number(count[1])+1) throw new Error('DOU: contagem ou paginação não confirmada');
  return {items:data.jsonArray as {title?:string;urlTitle?:string;hierarchyStr?:string;pubDate?:string;classPK?:string;score?:number;displayDateSortable?:string}[],
    totalPages:Number(pages),currentPage:Number(currentPage),total:Number(count[3])};
}
export function parseDouArticle(page: string, url: string): CositAbstract[] {
  const parsedUrl = new URL(url);
  if (parsedUrl.origin !== 'https://www.in.gov.br' || !/^\/(?:en\/)?web\/dou\/-\//.test(parsedUrl.pathname)) throw new Error('DOU: origem inválida');
  const body = page.match(/<div\b[^>]*class="[^"]*texto-dou[^\"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  if (!body || !/Coordenação-Geral de Tributação|\bCosit\b/i.test(plainText(page))) throw new Error('DOU: autoridade ou texto não confirmado');
  const paragraphs = [...body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].map(m=>({attrs:m[1],text:plainText(m[2])}));
  const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const records:CositAbstract[]=[];
  // The DOU frequently groups dozens of decisions in one publication. Never read only the first heading.
  for(let i=0;i<paragraphs.length;i++) {
    if(!/class="[^"]*identifica/.test(paragraphs[i].attrs)) continue;
    const act = paragraphs[i].text.match(/SOLUÇÃO DE (CONSULTA|DIVERGÊNCIA) N[º°o.]?\s*([\d.]+),?\s+DE\s+(\d{1,2})\s+DE\s+(\S+)\s+DE\s+(\d{4})/i);
    if(!act) continue;
    if(!months.includes(act[4].toLowerCase())) throw new Error('DOU: data de decisão inválida');
    const date = dateIso(`${act[3].padStart(2,'0')}/${String(months.indexOf(act[4].toLowerCase())+1).padStart(2,'0')}/${act[5]}`);
    const texts:string[]=[];
    let legal=false;
    for(let j=i+1;j<paragraphs.length&&!/class="[^"]*identifica/.test(paragraphs[j].attrs);j++) {
      if(/class="[^"]*(assina|cargo)/.test(paragraphs[j].attrs)) continue;
      texts.push(paragraphs[j].text);
      if(/Dispositivos Legais:/i.test(paragraphs[j].text)) {legal=true;break;}
    }
    const text=texts.join('\n');
    if(!/Assunto:\s*Classificação de Mercadorias/i.test(text)) continue;
    if(!legal||text.length<100) throw new Error('DOU: ementa incompleta');
    records.push(record(act[1].toUpperCase()==='CONSULTA'?'Solução de Consulta':'Solução de Divergência',act[2].replaceAll('.',''),date,text,url));
  }
  if(!records.length) throw new Error('DOU: nenhuma ementa classificada confirmada');
  return records;
}
export async function collectDou(first: string, last: string, transport: typeof fetch = fetch) {
  const signal = AbortSignal.timeout(35000); const records:CositAbstract[]=[];
  const params = new URLSearchParams({q:'"Classificação de Mercadorias"',exactDate:'personalizado',publishFrom:first.split('-').reverse().join('-'),publishTo:last.split('-').reverse().join('-'),sortType:'0',s:'do1',delta:'75'});
  const items:ReturnType<typeof parseDouSearch>['items']=[];
  const seen=new Set<string>();
  let expected=0;
  for(let page=1;page<=6;page++) {
    const data=parseDouSearch(await readPage(await transport(`${DOU_SOURCE}?${params}`,{cache:'no-store',signal,redirect:'error'})));
    if(data.currentPage!==page) throw new Error('DOU: paginação não respeitada');
    if(page===1) expected=data.total;
    if(data.total!==expected) throw new Error('DOU: contagem mudou durante coleta');
    for(const item of data.items) {
      if(!item.urlTitle||seen.has(item.urlTitle)) throw new Error('DOU: publicação repetida ou sem link');
      seen.add(item.urlTitle);items.push(item);
    }
    if(page>=data.totalPages) break;
    const lastItem=data.items.at(-1);
    if(!lastItem?.classPK||!lastItem.displayDateSortable||typeof lastItem.score!=='number') throw new Error('DOU: cursor de paginação ausente');
    params.set('currentPage',String(page));params.set('newPage',String(page+1));params.set('id',lastItem.classPK);
    params.set('displayDate',lastItem.displayDateSortable);params.set('score',String(lastItem.score));
  }
  if(items.length!==expected) throw new Error('DOU: coleta truncada');
  const relevant=items.filter(item=>item.title&&/SOLUÇÃO DE (CONSULTA|DIVERGÊNCIA)/i.test(item.title)
    && /Coordenação-Geral de Tributação|\bCosit\b/i.test(item.hierarchyStr??''));
  for(let start=0;start<relevant.length;start+=4) {
    const batches=await Promise.all(relevant.slice(start,start+4).map(async item=>{
      if(!item.urlTitle||!/^solucao-de-(?:consulta|divergencia)-[a-zA-Z0-9._-]+-\d+$/.test(item.urlTitle) || item.urlTitle.includes('..')||!item.pubDate) throw new Error('DOU: metadados incompletos');
      const date=dateIso(item.pubDate);if(date<first||date>last) throw new Error('DOU: data fora da janela');
      const url=`https://www.in.gov.br/web/dou/-/${item.urlTitle}`;
      return parseDouArticle(await readPage(await transport(url,{cache:'no-store',signal,redirect:'error'})),url);
    }));
    records.push(...batches.flat());
    if(records.length>1000) throw new Error('DOU: limite da coleta excedido');
  }
  return records;
}
function normalized(text: string) {return text.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();}
export function mergeAbstracts(previous: CositAbstract[], receita: CositAbstract[], dou: CositAbstract[]) {
  const rows = new Map(previous.map(r=>[r.id,r]));
  for (const r of [...receita,...dou]) {
    const old = rows.get(r.id);
    const conflicting = old && old.sourceUrl !== r.sourceUrl && normalized(old.abstract) !== normalized(r.abstract);
    if (conflicting) { // Keep both identified sources; never silently treat differing texts as identical.
      rows.set(r.id,{...old,sourceUrls:[...new Set([...(old.sourceUrls ?? [old.sourceUrl]),r.sourceUrl])],conflictingSources:true});
    } else rows.set(r.id,{...r,sourceUrls:[...new Set([...(old?.sourceUrls ?? (old ? [old.sourceUrl] : [])),r.sourceUrl])]});
  }
  return [...rows.values()].sort((a,b)=>b.decisionDate.localeCompare(a.decisionDate)||a.id.localeCompare(b.id));
}
