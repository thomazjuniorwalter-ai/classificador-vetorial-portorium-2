import { unstable_cache } from 'next/cache';
import snapshot from '../../data/cosit/candidates.json';
import { collectReceita, collectDou, mergeAbstracts, type CositAbstract, type CositCatalog } from './cosit-abstracts';

const fallback = snapshot.records as CositAbstract[];
let pending: Promise<CositCatalog> | undefined;
async function collect(): Promise<CositCatalog> {
  if (!pending) pending = (async () => {
    const last = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const first = new Date(Date.parse(last)-60*86400000).toISOString().slice(0,10);
    const results = await Promise.allSettled([collectReceita(first,last),collectDou(first,last)]);
    if (results.every(r=>r.status === 'rejected')) throw new Error('Fontes oficiais indisponíveis');
    const rows = results.map(r=>r.status === 'fulfilled' ? r.value : []);
    return {records:mergeAbstracts(fallback,rows[0],rows[1]),lastSuccessfulCollectionAt:new Date().toISOString(),
      refreshStatus:'official',sourceStatus:{receita:results[0].status === 'fulfilled' ? 'available' : 'unavailable',dou:results[1].status === 'fulfilled' ? 'available' : 'unavailable'}};
  })().finally(()=>{pending=undefined;});
  return pending;
}
// Public data only. No documents, descriptions, credentials or user identity enter this cache.
const cachedCollection = unstable_cache(collect,['cosit-public-abstracts-v1'],{revalidate:86400});
export async function getCositCatalog(): Promise<CositCatalog> {
  try {return await cachedCollection();}
  catch {return {records:fallback,lastSuccessfulCollectionAt:snapshot.lastSuccessfulCollectionAt,
    refreshStatus:'fallback',sourceStatus:{receita:'unavailable',dou:'unavailable'}};}
}
export function catalogMetadata(catalog: CositCatalog) {
  return {abstracts:catalog.records.length,collectedAt:catalog.lastSuccessfulCollectionAt,
    refreshStatus:catalog.refreshStatus,sourceStatus:catalog.sourceStatus,
    stale:Date.now()-Date.parse(catalog.lastSuccessfulCollectionAt)>27*60*60*1000};
}
