import {createHash} from 'node:crypto';
import type {CositAbstract, CositCatalog} from './cosit-abstracts.ts';

export type Source = 'receita' | 'dou';
export type Observation = {record:CositAbstract; source:Source; firstSeenAt:string; lastSeenAt:string};
export type CollectionRun = {
  id:string; collectionId?:string; at:string; collectorVersion:string; window:{from:string;to:string};
  sources:Record<Source, {status:'available'|'unavailable'; count:number; dateBasis:'decision'|'publication'}>;
};
export type Ledger = {
  schemaVersion:2; revision:string; observations:Observation[]; runs:CollectionRun[];
  seedCollectedAt?:string;
  // Only public-document vectors, keyed by model/dimensions/text hash. Never user queries.
  embeddings:Record<string,number[]>;
};
const sources:Source[]=['receita','dou'];
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const normalized=(text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const timestamp=(value:unknown)=>typeof value==='string' && Number.isFinite(Date.parse(value));
function official(url:string, source:Source) {
  const parsed=new URL(url);
  return parsed.protocol==='https:' && !parsed.username && !parsed.password && !parsed.port && (source==='receita'
    ? parsed.hostname==='atosdecisorios.receita.fazenda.gov.br'
    : parsed.hostname==='www.in.gov.br');
}
export function sealLedger(value:Omit<Ledger,'revision'>):Ledger {
  return {...value,revision:hash(JSON.stringify(value))};
}
export function validateLedger(value:any):Ledger {
  if(value?.schemaVersion!==2 || !Array.isArray(value.observations) || !Array.isArray(value.runs)
    || !value.embeddings || typeof value.embeddings!=='object' || Array.isArray(value.embeddings)
    || (value.seedCollectedAt!==undefined&&!timestamp(value.seedCollectedAt))) throw Error('Catálogo persistente inválido');
  const {revision,...payload}=value;
  if(revision!==hash(JSON.stringify(payload))) throw Error('Hash do catálogo divergente');
  const seen=new Set<string>();
  for(const o of value.observations) {
    const r=o.record;
    if(!sources.includes(o.source) || !timestamp(o.firstSeenAt) || !timestamp(o.lastSeenAt) || o.firstSeenAt>o.lastSeenAt
      || !r || typeof r.abstract!=='string' || r.abstract.length>20000 || !Array.isArray(r.ncm)
      || !/^\d{4}-\d{2}-\d{2}$/.test(r.decisionDate) || !timestamp(r.decisionDate)
      || !['Solução de Consulta','Solução de Divergência'].includes(r.type) || !/^\d+$/.test(r.number)
      || r.id!==`BR-COSIT-${r.type==='Solução de Consulta'?'SC':'SD'}-${r.number}-${r.decisionDate.slice(0,4)}`
      || r.authority!=='Cosit' || r.jurisdiction!=='BR' || r.integrity!=='abstract' || r.sha256!==hash(r.abstract)
      || !official(r.sourceUrl,o.source) || (r.sourceUrls??[]).some((u:string)=>!official(u,o.source))) throw Error('Observação oficial inválida');
    const key=`${o.source}/${r.id}/${r.sourceUrl}/${r.sha256}`;
    if(seen.has(key)) throw Error('Observação duplicada');
    seen.add(key);
  }
  const ids=new Set<string>();
  for(const run of value.runs) {
    if(!run.id || ids.has(run.id) || !timestamp(run.at) || !run.collectorVersion
      || (run.collectionId!==undefined&&(typeof run.collectionId!=='string'||!run.collectionId||run.collectionId.length>200))
      || !timestamp(run.window?.from) || !timestamp(run.window?.to) || run.window.from>run.window.to
      || sources.some(s=>!['available','unavailable'].includes(run.sources?.[s]?.status)
        || !Number.isInteger(run.sources[s].count) || run.sources[s].count<0
        || run.sources[s].dateBasis!==(s==='receita'?'decision':'publication'))) throw Error('Recibo de coleta inválido');
    ids.add(run.id);
  }
  const hashes=new Set(value.observations.map((o:Observation)=>o.record.sha256));
  for(const [key,vector] of Object.entries(value.embeddings) as [string,number[]][]) {
    if(!/^text-embedding-3-small:512:[a-f0-9]{64}$/.test(key) || !hashes.has(key.split(':')[2])
      || !Array.isArray(vector) || vector.length!==512 || vector.some(n=>typeof n!=='number'||!Number.isFinite(n))) throw Error('Vetor persistente inválido');
  }
  return value;
}
export function seedLedger(snapshot:{records:CositAbstract[];lastSuccessfulCollectionAt:string}):Ledger {
  // A merged seed cannot reconstruct an alternate source's original text. Do not invent it.
  return sealLedger({schemaVersion:2,seedCollectedAt:snapshot.lastSuccessfulCollectionAt,observations:snapshot.records.map(record=>({
    record:{...record,sourceUrls:[record.sourceUrl]},source:record.sourceUrl.startsWith('https://www.in.gov.br/')?'dou':'receita',
    firstSeenAt:snapshot.lastSuccessfulCollectionAt,lastSeenAt:snapshot.lastSuccessfulCollectionAt,
  })),runs:[],embeddings:{}});
}
export function appendCollection(previous:Ledger, run:CollectionRun, rows:Record<Source,CositAbstract[]>):Ledger {
  validateLedger(previous);
  if(previous.runs.some(r=>r.id===run.id)) throw Error('Execução já registrada; use uma nova tentativa identificada');
  if(previous.runs.some(r=>r.at>run.at)) throw Error('Coleta anterior à última execução');
  const observations=structuredClone(previous.observations);
  for(const source of sources) {
    if(run.sources[source].count!==rows[source].length || (run.sources[source].status==='unavailable'&&rows[source].length)) throw Error('Recibo e resultados divergentes');
    for(const record of rows[source]) {
      const found=observations.find(o=>o.source===source && o.record.id===record.id && o.record.sourceUrl===record.sourceUrl && o.record.sha256===record.sha256);
      if(found) found.lastSeenAt=run.at;
      else observations.push({source,record:{...record,sourceUrls:[record.sourceUrl]},firstSeenAt:run.at,lastSeenAt:run.at});
    }
  }
  return validateLedger(sealLedger({schemaVersion:2,seedCollectedAt:previous.seedCollectedAt,
    observations,runs:[...previous.runs,run],embeddings:previous.embeddings}));
}
export function ledgerCatalog(ledger:Ledger):CositCatalog {
  validateLedger(ledger);
  const groups=new Map<string,Observation[]>();
  for(const o of ledger.observations) groups.set(o.record.id,[...(groups.get(o.record.id)??[]),o]);
  const records=[...groups.values()].map(versions=>{
    // Latest observed version at each source URL; Receita preferred when current sources disagree.
    const latest=new Map<string,Observation>();
    for(const o of versions) {const key=`${o.source}/${o.record.sourceUrl}`;const old=latest.get(key);if(!old||o.lastSeenAt>=old.lastSeenAt) latest.set(key,o);}
    const current=[...latest.values()].sort((a,b)=>(a.source===b.source?b.lastSeenAt.localeCompare(a.lastSeenAt):a.source==='receita'?-1:1));
    const chosen=current[0];
    return {...chosen.record,sourceUrls:[...new Set(current.map(o=>o.record.sourceUrl))],
      conflictingSources:current.some(o=>normalized(o.record.abstract)!==normalized(chosen.record.abstract)) || chosen.record.conflictingSources===true,
      observedAt:chosen.lastSeenAt,versionCount:versions.length,validity:'unverified',
      hasRelationshipSignals:versions.some(o=>o.record.hasRelationshipSignals)};
  }).sort((a,b)=>b.decisionDate.localeCompare(a.decisionDate)||a.id.localeCompare(b.id));
  // One collection spans several windows. A later successful window must not hide an earlier failure.
  // Legacy receipts have no collectionId and remain independent, without guessing a grouping.
  const collections=new Map<string,CollectionRun[]>();
  for(const run of ledger.runs) {
    const key=run.collectionId?`collection:${run.collectionId}`:`legacy:${run.id}`;
    collections.set(key,[...(collections.get(key)??[]),run]);
  }
  const batches=[...collections.values()];
  const latest=batches.at(-1)??[];
  const sourceChecks=Object.fromEntries(sources.map(source=>{
    const attempts=ledger.runs.filter(r=>r.sources[source]);
    const last=attempts.at(-1);
    const success=attempts.filter(r=>r.sources[source].status==='available').sort((a,b)=>b.window.to.localeCompare(a.window.to)||b.at.localeCompare(a.at))[0];
    const failed=latest.filter(r=>r.sources[source].status==='unavailable').length;
    const status=!latest.length?'unverified':!failed?'available':failed===latest.length?'unavailable':'partial';
    return [source,{status,lastAttemptAt:last?.at,lastSuccessAt:success?.at,window:success?.window}];
  }));
  const successful=batches.filter(batch=>batch.every(run=>sources.every(source=>run.sources[source].status==='available'))).at(-1);
  const seedCollectedAt=ledger.seedCollectedAt??ledger.observations
    .filter(o=>!ledger.runs.length||o.firstSeenAt<ledger.runs[0].at).map(o=>o.firstSeenAt).sort().at(-1);
  return {records,lastSuccessfulCollectionAt:successful?.at(-1)?.at??seedCollectedAt??'1970-01-01T00:00:00Z',
    sourceStatus:{receita:sourceChecks.receita.status,dou:sourceChecks.dou.status},sourceChecks,
    refreshStatus:'persistent',persistenceStatus:'available',revision:ledger.revision,embeddings:ledger.embeddings};
}

// Fixed repository mirror, not a fiscal citation source. No user-controlled URLs or credentials.
export const PERSISTENT_CATALOG_URL='https://raw.githubusercontent.com/thomazjuniorwalter-ai/classificador-vetorial-portorium-2/cosit-catalog-data/data/cosit/ledger.json';
export async function loadPublishedLedger(transport:typeof fetch=fetch):Promise<Ledger> {
  const ref=process.env.COSIT_CATALOG_COMMIT;
  if(ref&&!/^[a-f0-9]{40}$/.test(ref))throw Error('Commit do catálogo inválido');
  const url=ref?PERSISTENT_CATALOG_URL.replace('/cosit-catalog-data/',`/${ref}/`):PERSISTENT_CATALOG_URL;
  const response=await transport(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw Error('Catálogo permanente indisponível');
  const reader=response.body?.getReader();if(!reader) throw Error('Catálogo permanente vazio');
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>32*1024*1024){await reader.cancel();throw Error('Catálogo permanente excede limite');}chunks.push(item.value);}}
  finally {reader.releaseLock();}
  return validateLedger(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
