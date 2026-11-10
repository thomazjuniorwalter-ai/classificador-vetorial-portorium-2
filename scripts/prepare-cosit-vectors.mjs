// Dry run by default. Document embeddings only; never classifications, uploads, or user descriptions.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateLedger,sealLedger,ledgerCatalog} from '../app/lib/cosit-ledger.ts';
const model='text-embedding-3-small',dimensions=512;
export function vectorPlan(ledger) {
  validateLedger(ledger);
  return ledgerCatalog(ledger).records.filter(r=>!ledger.embeddings[`${model}:${dimensions}:${r.sha256}`]);
}
export async function prepareVectors(ledger,transport) {
  const records=vectorPlan(ledger);const embeddings={...ledger.embeddings};
  for(let start=0;start<records.length;start+=32) {
    const batch=records.slice(start,start+32);
    const body=await transport({model,dimensions,input:batch.map(r=>r.abstract.slice(0,12000)),encoding_format:'float'});
    if(!Array.isArray(body.data)||body.data.length!==batch.length) throw Error('Embeddings incompletos');
    const seen=new Set();
    for(const row of body.data) {
      if(!Number.isInteger(row.index)||row.index<0||row.index>=batch.length||seen.has(row.index)
        ||!Array.isArray(row.embedding)||row.embedding.length!==dimensions||row.embedding.some(n=>typeof n!=='number'||!Number.isFinite(n))) throw Error('Embedding inválido');
      seen.add(row.index);embeddings[`${model}:${dimensions}:${batch[row.index].sha256}`]=row.embedding;
    }
  }
  const {revision,...payload}=ledger;
  return validateLedger(sealLedger({...payload,embeddings}));
}
async function main() {
  const ledger=validateLedger(JSON.parse(await fs.readFile('.cosit/ledger.json','utf8')));
  if(!process.argv.includes('--apply')) {console.log(JSON.stringify({mode:'dry_run',documents:vectorPlan(ledger).length,model,dimensions}));return;}
  if(process.env.COSIT_ALLOW_EXTERNAL_SYNC!=='1'||!process.env.OPENAI_API_KEY) throw Error('Geração externa não autorizada ou não configurada');
  const report=JSON.parse(await fs.readFile('.cosit/report.json','utf8'));
  await fs.writeFile('.cosit/report.json',JSON.stringify({...report,externalVectorSync:'attempted'},null,2)+'\n');
  const next=await prepareVectors(ledger,async body=>{
    const response=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error(`Embeddings HTTP ${response.status}`);
    return response.json();
  });
  await fs.writeFile('.cosit/ledger.json.tmp',JSON.stringify(next,null,2)+'\n');
  await fs.rename('.cosit/ledger.json.tmp','.cosit/ledger.json');
  // Report points to exactly the snapshot that may be published.
  await fs.writeFile('.cosit/report.json',JSON.stringify({...report,after:next.revision,externalVectorSync:'document_embeddings_prepared'},null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
