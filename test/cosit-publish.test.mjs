import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {seedLedger} from '../app/lib/cosit-ledger.ts';
const publisher=path.resolve('scripts/publish-cosit-catalog.mjs');
const snapshot=JSON.parse(fs.readFileSync('data/cosit/candidates.json','utf8'));
const ledger=seedLedger(snapshot);
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
test('publicação simulada usa Git local, preserva main e rejeita base concorrente ou relatório divergente',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cosit-publish-'));
 try {
  const bare=path.join(temporary,'origin.git'),repo=path.join(temporary,'repo');
  fs.mkdirSync(repo);git(temporary,['init','--bare',bare]);git(repo,['init','-b','main']);
  fs.writeFileSync(path.join(repo,'README.md'),'Base preservada');git(repo,['add','README.md']);
  git(repo,['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture']);
  git(repo,['remote','add','origin',bare]);git(repo,['push','origin','main']);
  const head=git(repo,['rev-parse','HEAD']);fs.mkdirSync(path.join(repo,'.cosit'));
  const write=(name,content)=>fs.writeFileSync(path.join(repo,'.cosit',name),content);
  write('ledger.json',JSON.stringify(ledger));write('base-sha','');write('report.json',JSON.stringify({after:ledger.revision}));
  const publish=()=>execFileSync(process.execPath,[publisher],{cwd:repo,env:{...process.env,COSIT_PUBLISH_APPROVED:'1'},stdio:['pipe','pipe','pipe'],encoding:'utf8'});
  const result=JSON.parse(publish());assert.equal(result.published,true);
  assert.equal(git(repo,['ls-remote','origin','refs/heads/main']).split(/\s+/)[0],head);
  assert.equal(git(repo,['show',`${result.commit}:data/cosit/ledger.json`]),JSON.stringify(ledger));
  assert.throws(publish,error=>error.stderr.toString().includes('Catálogo mudou'));
  write('base-sha',result.commit);write('report.json',JSON.stringify({after:'wrong'}));
  assert.throws(publish,error=>error.stderr.toString().includes('Relatório não corresponde'));
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});
