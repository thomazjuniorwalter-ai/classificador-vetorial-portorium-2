// Local dry run by default. External writes require explicit apply, authorization, manifest hash and target store.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function validateManifest(records, candidates, readText, readOriginal) {
  const ids = new Set();
  const documents = [];
  for (const record of records) {
    if (ids.has(record.id)) throw new Error('Decisão duplicada no manifesto');
    ids.add(record.id);
    if (record.ingestionStatus !== 'ready') continue;
    if (record.integrity !== 'full' || record.jurisdiction !== 'BR' || !record.collectedAt || !record.title
      || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Metadados incompletos: ' + record.id);
    const url = new URL(record.sourceUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'receita.fazenda.gov.br' || url.hostname.endsWith('.receita.fazenda.gov.br')
      || ['www.gov.br', 'www.in.gov.br'].includes(url.hostname))) throw new Error('Fonte não oficial');
    const candidate = candidates.find(item => item.id === record.id);
    if (!candidate || candidate.sha256 !== record.abstractSha256) throw new Error('Ementa alterada; recapturar íntegra correspondente');
    if (!/^data\/cosit\/full\/[a-zA-Z0-9_.-]+\.txt$/.test(record.textPath)) throw new Error('Caminho de íntegra inválido');
    const proof=record.completeness;
    if(!proof || proof.method!=='official-full-text' || proof.decisionId!==record.id
      || !Number.isFinite(Date.parse(proof.verifiedAt)) || !/^[a-f0-9]{64}$/.test(proof.originalSha256||'')
      || !/^data\/cosit\/full\/original\/[a-zA-Z0-9_.-]+\.(pdf|html|txt)$/.test(proof.originalPath||'')
      || !proof.evidence || proof.evidence.length<20) throw new Error('Verificação de íntegra ausente: '+record.id);
    if(!readOriginal || createHash('sha256').update(await readOriginal(proof.originalPath)).digest('hex')!==proof.originalSha256)
      throw new Error('Original da íntegra ausente ou divergente');
    const text = await readText(record.textPath);
    if (createHash('sha256').update(text).digest('hex') !== record.sha256) throw new Error('Hash da íntegra divergente');
    if (text.trim().length < 500 || text.trim() === candidate.abstract.trim()) throw new Error('Íntegra insuficiente');
    documents.push({record, text});
  }
  return documents;
}

// Plan is local and deterministic. Apply never retires or deletes any remote document.
export function synchronizationPlan(documents) {
  return {mode:'dry_run',documents:documents.map(({record})=>({id:record.id,sha256:record.sha256})),
    retirements:0,deletions:0};
}
export async function synchronizeDocuments(documents, existing, api, base, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)), checkpoint={uploads:{},save:async()=>{}}) {
  if(!documents.length) throw Error('Manifesto vazio: sincronização bloqueada');
  const prepared=[];
  // Prepare ALL documents before exposing any new version. Old versions remain untouched.
  for(const {record,text} of documents) {
    let file=existing.find(item=>item.attributes?.collector==='cosit-pilot'
      && item.attributes?.decision_id===record.id && item.attributes?.sha256===record.sha256);
    const attributes={collector:'cosit-pilot',jurisdiction:'BR',integrity:'full',status:'pending',
      decision_id:record.id,sha256:record.sha256,source_url:record.sourceUrl,title:record.title,collected_at:record.collectedAt};
    if(file && ['failed','cancelled'].includes(file.status)) throw Error('Arquivo anterior falhou; revisar antes de repetir: '+record.id);
    if(!file) {
      const uploadKey=`${record.id}/${record.sha256}`;
      let fileId=checkpoint.uploads[uploadKey];
      if(!fileId) {
        const form=new FormData();form.append('purpose','assistants');
        form.append('file',new Blob([`${record.title}\nFonte: ${record.sourceUrl}\n\n${text}`],{type:'text/plain'}),record.id+'.txt');
        const uploaded=await api('/files',form);
        if(typeof uploaded.id!=='string')throw Error('Upload sem identificador');
        fileId=uploaded.id;checkpoint.uploads[uploadKey]=fileId;
        await checkpoint.save(); // Persist known uploads before attaching. Response-loss needs manual reconciliation.
      }
      file=await api(base,{file_id:fileId,attributes});
    }
    for(let attempt=0;file.status==='in_progress'&&attempt<30;attempt++) {
      await pause(2000);file=await api(`${base}/${file.id}`,undefined,'GET');
    }
    if(file.status!=='completed') throw Error('Indexação não concluída: '+record.id);
    prepared.push({file,attributes});
  }
  for(const {file,attributes} of prepared) {
    if(file.attributes?.status!=='indexed') await api(`${base}/${file.id}`,{attributes:{...attributes,status:'indexed'}});
  }
  return {status:'synchronized',fullTexts:documents.length,retirements:0,deletions:0};
}
async function main() {
  const raw=await fs.readFile(path.join(root,'data/cosit/approved.json'),'utf8');
  const manifest=JSON.parse(raw);
  const candidates=JSON.parse(await fs.readFile(path.join(root,'data/cosit/candidates.json'),'utf8'));
  const documents=await validateManifest(manifest.records,candidates.records,relative=>fs.readFile(path.join(root,relative),'utf8'),relative=>fs.readFile(path.join(root,relative)));
  const manifestSha256=createHash('sha256').update(raw).digest('hex');
  if(!process.argv.includes('--apply')) {
    console.log(JSON.stringify({...synchronizationPlan(documents),manifestSha256}));return;
  }
  const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
  const key=process.env.OPENAI_API_KEY,store=process.env.OPENAI_COSIT_VECTOR_STORE_ID;
  if(process.env.COSIT_ALLOW_EXTERNAL_SYNC!=='1') throw Error('Sincronização externa não autorizada');
  if(!documents.length) throw Error('Manifesto vazio: sincronização bloqueada');
  if(argument('--manifest-sha')!==manifestSha256) throw Error('Aprovar o hash exato do manifesto antes de aplicar');
  if(!key||!/^vs_[a-zA-Z0-9_-]+$/.test(store||'')||argument('--store')!==store) throw Error('Confirmar o store Cosit dedicado');
  const api=async(endpoint,body,method='POST')=>{
    const response=await fetch('https://api.openai.com/v1'+endpoint,{
      method,redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:`Bearer ${key}`,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),
    });
    if(!response.ok)throw Error('OpenAI HTTP '+response.status);
    return response.json();
  };
  const base=`/vector_stores/${store}/files`,existing=[];
  let cursor='';const seen=new Set();
  do {
    const page=await api(`${base}?limit=100${cursor?'&after='+encodeURIComponent(cursor):''}`,undefined,'GET');
    if(!Array.isArray(page.data))throw Error('Inventário vetorial inválido');
    existing.push(...page.data);
    cursor=page.has_more?page.last_id:'';
    if(page.has_more&&(!cursor||seen.has(cursor)))throw Error('Paginação vetorial inválida');
    seen.add(cursor);
  }while(cursor);
  const statePath=path.join(root,'.cosit/full-sync-state.json');
  let state={store,manifestSha256,uploads:{}};
  try {state=JSON.parse(await fs.readFile(statePath,'utf8'));}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  if(state.store!==store||state.manifestSha256!==manifestSha256||!state.uploads||typeof state.uploads!=='object')throw Error('Checkpoint pertence a outro plano; preservar e revisar');
  const checkpoint={uploads:state.uploads,save:async()=>{
    await fs.mkdir(path.dirname(statePath),{recursive:true});
    await fs.writeFile(statePath+'.tmp',JSON.stringify(state,null,2)+'\n');await fs.rename(statePath+'.tmp',statePath);
  }};
  console.log(JSON.stringify(await synchronizeDocuments(documents,existing,api,base,undefined,checkpoint)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
