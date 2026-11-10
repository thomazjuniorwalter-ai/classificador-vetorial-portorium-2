// Git-only publication, to a dedicated data branch. Never changes main or any vector store.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {validateLedger} from '../app/lib/cosit-ledger.ts';
if(process.env.COSIT_PUBLISH_APPROVED!=='1') throw Error('Publicação desativada');
const bytes=await fs.readFile('.cosit/ledger.json','utf8');
if(Buffer.byteLength(bytes)>32*1024*1024) throw Error('Catálogo excede limite de leitura; dividir o acervo antes de publicar');
const ledger=validateLedger(JSON.parse(bytes));
const report=JSON.parse(await fs.readFile('.cosit/report.json','utf8'));
if(report.after!==ledger.revision) throw Error('Relatório não corresponde ao catálogo');
const base=(await fs.readFile('.cosit/base-sha','utf8')).trim();
if(base&&!/^[a-f0-9]{40}$/.test(base)) throw Error('Base Git inválida');
const git=(args,input)=>execFileSync('git',args,{input,encoding:'utf8',env:{...process.env,GIT_INDEX_FILE:`${process.cwd()}/.cosit/git-index`}}).trim();
const current=git(['ls-remote','origin','refs/heads/cosit-catalog-data']).split(/\s+/)[0];
if(current!==base) throw Error('Catálogo mudou durante coleta; repetir com a base atual');
if(base)git(['fetch','--no-tags','origin',base]);
const blob=git(['hash-object','-w','--stdin'],await fs.readFile('.cosit/ledger.json','utf8'));
git(['read-tree','--empty']);
git(['update-index','--add','--cacheinfo',`100644,${blob},data/cosit/ledger.json`]);
const tree=git(['write-tree']);
const commit=git(['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com',
  'commit-tree',tree,...(base?['-p',base]:[]),'-m',`Atualiza catálogo público Cosit ${ledger.revision.slice(0,12)}`]);
git(['push','origin',`${commit}:refs/heads/cosit-catalog-data`]); // Non-forced push rejects concurrent changes.
console.log(JSON.stringify({published:true,revision:ledger.revision,commit,branch:'cosit-catalog-data'}));
