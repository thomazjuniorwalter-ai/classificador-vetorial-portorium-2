import { unstable_cache } from 'next/cache';
import snapshot from '../../data/cosit/candidates.json';
import { collectReceita, collectDou, mergeAbstracts, type CositAbstract, type CositCatalog } from './cosit-abstracts';
import {ledgerCatalog, loadPublishedLedger} from './cosit-ledger';

const fallback = snapshot.records as CositAbstract[];
let pending: Promise<CositCatalog> | undefined;
async function collect(): Promise<CositCatalog> {
  if (!pending) pending = (async () => {
    // Opt-in only. If enabled, throw on mirror failure so Next retains its last successful cache.
    if (process.env.COSIT_PERSISTENT_CATALOG === '1') return ledgerCatalog(await loadPublishedLedger());
    const last = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const first = new Date(Date.parse(last)-60*86400000).toISOString().slice(0,10);
    const results = await Promise.allSettled([collectReceita(first,last),collectDou(first,last)]);
    if (results.every(r=>r.status === 'rejected')) throw new Error('Fontes oficiais indisponíveis');
    const rows = results.map(r=>r.status === 'fulfilled' ? r.value : []);
    const now=new Date().toISOString();
    return {records:mergeAbstracts(fallback,rows[0],rows[1]),lastSuccessfulCollectionAt:now,
      refreshStatus:'official',persistenceStatus:'disabled',
      sourceChecks:Object.fromEntries(['receita','dou'].map((source,i)=>[source,{
        status:results[i].status==='fulfilled'?'available':'unavailable',lastAttemptAt:now,
        lastSuccessAt:results[i].status==='fulfilled'?now:undefined,window:{from:first,to:last},
      }])),
      sourceStatus:{receita:results[0].status === 'fulfilled' ? 'available' : 'unavailable',dou:results[1].status === 'fulfilled' ? 'available' : 'unavailable'}};
  })().finally(()=>{pending=undefined;});
  return pending;
}
// Separate cache keys prevent a rollout or rollback from reusing the other mode's catalog.
const cachedCollection = unstable_cache(collect,['cosit-public-abstracts-v2'],{revalidate:86400});
const cachedPersistent = unstable_cache(collect,['cosit-persistent-abstracts-v2'],{revalidate:900});
export async function getCositCatalog(): Promise<CositCatalog> {
  try {return await (process.env.COSIT_PERSISTENT_CATALOG==='1'?cachedPersistent():cachedCollection());}
  catch {return {records:fallback,lastSuccessfulCollectionAt:snapshot.lastSuccessfulCollectionAt,
    persistenceStatus:process.env.COSIT_PERSISTENT_CATALOG==='1'?'unavailable':'disabled',
    refreshStatus:'fallback',sourceStatus:{receita:'unavailable',dou:'unavailable'}};}
}
export function catalogMetadata(catalog: CositCatalog) {
  const staleSources=catalog.sourceChecks
    ? Object.entries(catalog.sourceChecks).filter(([,s])=>s.status!=='available'||!s.lastSuccessAt||Date.now()-Date.parse(s.lastSuccessAt)>27*60*60*1000 || !s.window?.to || Date.now()-Date.parse(s.window.to)>3*86400000).map(([name])=>name)
    : ['receita','dou'].filter(name=>catalog.sourceStatus[name]!=='available');
  return {abstracts:catalog.records.length,collectedAt:catalog.lastSuccessfulCollectionAt,
    refreshStatus:catalog.refreshStatus,sourceStatus:catalog.sourceStatus,sourceChecks:catalog.sourceChecks,
    persistenceStatus:catalog.persistenceStatus??'disabled',catalogRevision:catalog.revision,
    historicalCoverage:'partial',validity:'unverified',staleSources,
    conflicts:catalog.records.filter(r=>r.conflictingSources).length,
    relationshipSignals:catalog.records.filter(r=>r.hasRelationshipSignals).length,
    stale:staleSources.length>0 || Date.now()-Date.parse(catalog.lastSuccessfulCollectionAt)>27*60*60*1000};
}
