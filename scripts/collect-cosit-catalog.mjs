// Collect official sources only; writes a local, cumulative ledger. Does not publish or call OpenAI.
import fs from 'node:fs/promises';
import {collectionWindow} from '../app/lib/cosit-window.ts';
import {collectReceita,collectDou} from '../app/lib/cosit-abstracts.ts';
import {appendCollection,seedLedger,validateLedger,ledgerCatalog} from '../app/lib/cosit-ledger.ts';
const directory='.cosit';
await fs.mkdir(directory,{recursive:true});
let previous;
try {previous=validateLedger(JSON.parse(await fs.readFile(`${directory}/ledger.json`,'utf8')));}
catch(error) {if(error.code!=='ENOENT') throw error;previous=seedLedger(JSON.parse(await fs.readFile('data/cosit/candidates.json','utf8')));}
const before=previous;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const window=collectionWindow(today,{from:process.env.COSIT_FROM,to:process.env.COSIT_TO,
  reconcile:process.env.COSIT_RECONCILE==='1',startYear:process.env.COSIT_HISTORY_START_YEAR});
const start=window.from,end=window.to;
let failed=false;
for(let from=start;from<=end;) {
  const to=new Date(Math.min(Date.parse(end),Date.parse(from)+13*86400000)).toISOString().slice(0,10);
  const retry=async(fn)=>{for(let attempt=0;;attempt++){try{return await fn(from,to);}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,500*2**attempt));}}};
  const results=await Promise.allSettled([retry(collectReceita),retry(collectDou)]);
  const rows={receita:results[0].status==='fulfilled'?results[0].value:[],dou:results[1].status==='fulfilled'?results[1].value:[]};
  const at=new Date().toISOString();
  const run={id:`${process.env.GITHUB_RUN_ID||'local'}-${process.env.GITHUB_RUN_ATTEMPT||'1'}-${from}-${at}`,at,
    collectorVersion:process.env.GITHUB_SHA||'local',window:{from,to},sources:Object.fromEntries(['receita','dou'].map((s,i)=>[s,{
      status:results[i].status==='fulfilled'?'available':'unavailable',count:rows[s].length,dateBasis:s==='receita'?'decision':'publication',
    }]))};
  previous=appendCollection(previous,run,rows);
  await fs.writeFile(`${directory}/ledger.json.tmp`,JSON.stringify(previous,null,2)+'\n');
  await fs.rename(`${directory}/ledger.json.tmp`,`${directory}/ledger.json`);
  failed ||= results.some(r=>r.status==='rejected');
  from=new Date(Date.parse(to)+86400000).toISOString().slice(0,10);
}
const catalog=ledgerCatalog(previous);
const report={status:failed?'partial_or_failed':'complete',before:before.revision,after:previous.revision,
  newObservations:previous.observations.length-before.observations.length,totalActs:catalog.records.length,
  conflicts:catalog.records.filter(r=>r.conflictingSources).length,sourceChecks:catalog.sourceChecks,
  historicalCoverage:'partial',validity:'unverified',externalVectorSync:'not_executed'};
await fs.writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(failed) process.exitCode=1; // Preserve and publish last valid records plus honest failure receipts.
