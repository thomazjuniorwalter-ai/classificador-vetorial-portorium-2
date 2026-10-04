// Run only for reviewed full texts. Credentials stay in the execution environment.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function validateManifest(records, candidates, readText) {
  const ids = new Set();
  const documents = [];
  for (const record of records) {
    if (ids.has(record.id)) throw new Error('Decisão duplicada no manifesto');
    ids.add(record.id);
    if (record.reviewStatus !== 'approved') continue;
    if (record.integrity !== 'full' || record.jurisdiction !== 'BR' || !record.reviewedBy
      || !record.reviewedAt || !record.validityCheckedAt || !record.title
      || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Revisão incompleta: ' + record.id);
    const url = new URL(record.sourceUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'receita.fazenda.gov.br' || url.hostname.endsWith('.receita.fazenda.gov.br')
      || ['www.gov.br', 'www.in.gov.br'].includes(url.hostname))) throw new Error('Fonte não oficial');
    const candidate = candidates.find(item => item.id === record.id);
    if (!candidate || candidate.sha256 !== record.abstractSha256) throw new Error('Ementa alterada; nova revisão necessária');
    if (!/^data\/cosit\/full\/[a-zA-Z0-9_.-]+\.txt$/.test(record.textPath)) throw new Error('Caminho de íntegra inválido');
    const text = await readText(record.textPath);
    if (createHash('sha256').update(text).digest('hex') !== record.sha256) throw new Error('Hash da íntegra divergente');
    if (text.trim().length < 500 || text.trim() === candidate.abstract.trim()) throw new Error('Íntegra insuficiente');
    documents.push({record, text});
  }
  return documents;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'data/cosit/approved.json'), 'utf8'));
  const candidates = JSON.parse(await fs.readFile(path.join(root, 'data/cosit/candidates.json'), 'utf8'));
  // Validate EVERYTHING before mutations. Human approval attests completeness and legal relationships.
  const documents = await validateManifest(manifest.records, candidates.records, relative => fs.readFile(path.join(root, relative), 'utf8'));
  const key = process.env.OPENAI_API_KEY;
  const store = process.env.OPENAI_COSIT_VECTOR_STORE_ID;
  if (!key || !/^vs_[a-zA-Z0-9_-]+$/.test(store || '')) throw new Error('Integração vetorial não configurada');
  const api = async (endpoint, body, method = 'POST') => {
    const response = await fetch('https://api.openai.com/v1' + endpoint, {
      method, signal: AbortSignal.timeout(30_000),
      headers: {Authorization: `Bearer ${key}`, ...(body instanceof FormData ? {} : {'Content-Type':'application/json'})},
      ...(body === undefined ? {} : {body: body instanceof FormData ? body : JSON.stringify(body)}),
    });
    if (!response.ok) throw new Error('OpenAI HTTP ' + response.status);
    return response.json();
  };
  const base = `/vector_stores/${store}/files`;
  const existing = [];
  let cursor = '';
  do {
    const page = await api(`${base}?limit=100${cursor ? '&after=' + encodeURIComponent(cursor) : ''}`, undefined, 'GET');
    existing.push(...page.data);
    cursor = page.has_more ? page.last_id : '';
  } while (cursor);
  const expected = new Map(documents.map(({record}) => [record.id, record.sha256]));
  // Retire stale managed versions before new ones. Never delete or modify the original normative stores.
  for (const item of existing) {
    const attributes = item.attributes || {};
    if (attributes.collector === 'cosit-pilot' && expected.get(attributes.decision_id) !== attributes.sha256)
      await api(`${base}/${item.id}`, {attributes: {...attributes, status: 'retired'}});
  }
  for (const {record, text} of documents) {
    let file = existing.find(item => item.attributes?.collector === 'cosit-pilot'
      && item.attributes?.decision_id === record.id && item.attributes?.sha256 === record.sha256);
    const attributes = {collector:'cosit-pilot', jurisdiction:'BR', integrity:'full', status:'pending',
      decision_id: record.id, sha256: record.sha256, source_url: record.sourceUrl,
      title: record.title, validity_checked_at: record.validityCheckedAt};
    if (!file) {
      const form = new FormData();
      form.append('purpose', 'assistants');
      form.append('file', new Blob([`${record.title}\nFonte: ${record.sourceUrl}\n\n${text}`], {type:'text/plain'}), record.id + '.txt');
      const uploaded = await api('/files', form);
      file = await api(base, {file_id: uploaded.id, attributes});
    }
    for (let attempt = 0; file.status === 'in_progress' && attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      file = await api(`${base}/${file.id}`, undefined, 'GET');
    }
    if (file.status !== 'completed') throw new Error('Indexação não concluída: ' + record.id);
    await api(`${base}/${file.id}`, {attributes: {...attributes, status:'approved'}});
  }
  console.log(JSON.stringify({status:'synchronized', reviewedFullTexts:documents.length}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
