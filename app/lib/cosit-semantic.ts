import type { CositAbstract } from './cosit-abstracts';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 512;
// This bounded cache contains vectors of public official abstracts only, never user queries.
const vectors = new Map<string,number[]>();
let corpusPending: Promise<void> | undefined;
async function embed(texts: string[], key: string, transport: typeof fetch) {
  const response = await transport('https://api.openai.com/v1/embeddings',{method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
    body:JSON.stringify({model:MODEL,input:texts,dimensions:DIMENSIONS,encoding_format:'float'})});
  if (!response.ok) throw new Error('Pesquisa vetorial de ementas indisponível');
  const body = await response.json();
  if (!Array.isArray(body.data) || body.data.length !== texts.length) throw new Error('Embeddings incompletos');
  const result: number[][] = Array.from({length:texts.length});
  for (const item of body.data) {
    if (!Number.isInteger(item.index) || item.index<0 || item.index>=texts.length || result[item.index]
      || !Array.isArray(item.embedding) || item.embedding.length!==DIMENSIONS || item.embedding.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n))) throw new Error('Embedding inválido');
    result[item.index]=item.embedding;
  }
  return result;
}
export function cosine(a:number[],b:number[]) {
  let dot=0,aa=0,bb=0;
  if(a.length!==b.length) return 0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return aa&&bb ? dot/Math.sqrt(aa*bb) : 0;
}
export function lexicalCandidates(query: string, rows:CositAbstract[]) {
  const tokenize=(s:string)=>new Set(s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{4,}/g)??[]);
  const tokens=tokenize(query); const docs=rows.map(r=>tokenize(r.abstract));
  const frequencies=new Map<string,number>();
  for(const doc of docs) for(const t of doc) frequencies.set(t,(frequencies.get(t)??0)+1);
  return rows.map((r,i)=>({r,score:[...tokens].reduce((sum,t)=>sum+(docs[i].has(t)?Math.log(1+rows.length/(frequencies.get(t)??1)):0),0)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.r);
}
export async function selectAbstracts(query:string,rows:CositAbstract[],key:string,transport:typeof fetch=fetch) {
  const eligible=rows.filter(r=>r.integrity==='abstract'&&r.jurisdiction==='BR'&&r.authority==='Cosit'&&r.abstract);
  if(!eligible.length) return {records:[] as CositAbstract[],mode:'empty'};
  try {
    // Chunking protects embedding service input limits. Coalesce parallel batch classifications.
    if(corpusPending) await corpusPending;
    const missing=eligible.filter(r=>!vectors.has(r.sha256));
    if(missing.length) {
      corpusPending=(async()=>{
        for(let start=0;start<missing.length;start+=32){
          const chunk=missing.slice(start,start+32);
          const embedded=await embed(chunk.map(r=>r.abstract.slice(0,12000)),key,transport);
          chunk.forEach((r,i)=>vectors.set(r.sha256,embedded[i]));
        }
        while(vectors.size>1000) vectors.delete(vectors.keys().next().value!);
      })().finally(()=>{corpusPending=undefined;});
      await corpusPending;
    }
    const [queryVector]=await embed([query.slice(0,8000)],key,transport);
    const ranked=eligible.map(r=>({r,score:cosine(queryVector,vectors.get(r.sha256)??[])})).sort((a,b)=>b.score-a.score);
    return {records:ranked.slice(0,8).map(x=>x.r),mode:'semantic'};
  } catch {
    return {records:lexicalCandidates(query,eligible),mode:'lexical_fallback'};
  }
}
