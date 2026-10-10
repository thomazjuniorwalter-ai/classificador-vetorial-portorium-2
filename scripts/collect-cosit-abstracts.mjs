import fs from 'node:fs/promises';
import {collectReceita,collectDou,mergeAbstracts} from '../app/lib/cosit-abstracts.ts';

const path='data/cosit/candidates.json';
const previous=JSON.parse(await fs.readFile(path,'utf8'));
const last=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const first=new Date(Date.parse(last)-60*86400000).toISOString().slice(0,10);
const results=await Promise.allSettled([collectReceita(first,last),collectDou(first,last)]);
if(results.every(r=>r.status==='rejected')) throw new Error('Coleta falhou em ambas as fontes; catálogo anterior preservado');
const rows=results.map(r=>r.status==='fulfilled'?r.value:[]);
const records=mergeAbstracts(previous.records,rows[0],rows[1]).map(r=>({...r,ingestionStatus:'ready_abstract'}));
const catalog={...previous,records,lastSuccessfulCollectionAt:new Date().toISOString(),collectionWindow:{from:first,to:last},
  sourceStatus:{receita:results[0].status==='fulfilled'?'available':'unavailable',dou:results[1].status==='fulfilled'?'available':'unavailable'}};
await fs.writeFile(path,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({records:records.length,sourceStatus:catalog.sourceStatus,collectedAt:catalog.lastSuccessfulCollectionAt}));
if(results.some(r=>r.status==='rejected')) process.exitCode=1; // Partial collection remains available as an artifact, with honest failure status.
