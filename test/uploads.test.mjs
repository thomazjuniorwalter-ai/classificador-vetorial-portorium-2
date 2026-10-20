import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as limits from '../app/lib/upload-limits.ts';

const nativeRequire = createRequire(import.meta.url);
const secret = 'test-only-upload-key';
function loader({ access = 'authorized', email = 'tester@example.invalid', upstream, browser } = {}) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports, File, Blob, FormData, Request, Response, Buffer, Date,
      process: { env: { OPENAI_API_KEY: secret } },
      fetch: (...args) => args[0].startsWith('/') ? browser(...args) : upstream(...args),
      require: name => {
        if (name.startsWith('node:')) return nativeRequire(name);
        if (name.endsWith('/auth')) return {
          getPortalAccess: async () => ({ status: access, email }),
          portalAccessResponse: () => Response.json({ error: 'Sessão expirada' }, { status: 401 }),
        };
        return load(path.resolve(path.dirname(filename), name + '.ts'));
      },
    });
    return module.exports;
  }
  return load;
}
const jsonRequest = body => new Request('https://qa.invalid/api/arquivos/multipart', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('document limits accept exactly 100 MB and reject excess, empty, invalid and direct-input overflow', () => {
  assert.doesNotThrow(() => limits.validateDocuments([{ name: 'manual.pdf', size: limits.MAX_FILE_SIZE }]));
  assert.doesNotThrow(() => limits.validateDocuments([{ name: 'manual.pdf', size: 60 * 1024 ** 2 }, { name: 'ficha.docx', size: 40 * 1024 ** 2 }]));
  for (const files of [
    [{ name: 'manual.pdf', size: limits.MAX_FILE_SIZE + 1 }],
    [{ name: 'manual.pdf', size: limits.MAX_FILE_SIZE }, { name: 'extra.txt', size: 1 }],
    [{ name: 'empty.pdf', size: 0 }], [{ name: 'bad.exe', size: 10 }],
    Array.from({ length: 11 }, (_, i) => ({ name: `${i}.txt`, size: 1 })),
    [{ name: 'data.xlsx', size: 50 * 1024 ** 2 }],
    [{ name: 'a.csv', size: 26 * 1024 ** 2 }, { name: 'b.csv', size: 25 * 1024 ** 2 }],
  ]) assert.throws(() => limits.validateDocuments(files));
});

test('100 MB browser-to-route upload preserves bytes, order, signature, filename and request body limit', async () => {
  const input = Buffer.alloc(limits.MAX_FILE_SIZE, 0x37);
  input[0] = 1; input[input.length - 1] = 255;
  const hash = createHash('sha256'), parts = [], progress = [];
  let received = 0, largestRequest = 0, completed = false;
  let load;
  const upstream = async (url, init) => {
    if (url.endsWith('/uploads')) {
      const body = JSON.parse(init.body);
      assert.equal(body.bytes, input.length);
      assert.equal(body.filename, 'Manual.pdf');
      assert.equal(body.mime_type, 'application/pdf');
      assert.equal(body.purpose, 'assistants');
      assert.equal(body.expires_after.seconds, 86400);
      return Response.json({ id: 'upload_100mb', expires_at: Date.now() / 1000 + 3600 });
    }
    if (url.endsWith('/parts')) {
      const data = init.body.get('data');
      assert.ok(data.size <= limits.UPLOAD_CHUNK_SIZE);
      hash.update(Buffer.from(await data.arrayBuffer())); received += data.size;
      const id = `part_${parts.length}`; parts.push(id);
      return Response.json({ id });
    }
    if (url.endsWith('/complete')) {
      assert.deepEqual(JSON.parse(init.body).part_ids, parts);
      assert.equal(received, input.length);
      assert.equal(hash.digest('hex'), createHash('sha256').update(input).digest('hex'));
      completed = true;
      return Response.json({ status: 'completed', bytes: received, file: { id: 'file-100mb', bytes: received } });
    }
    throw new Error(`Unexpected upstream call: ${url}`);
  };
  load = loader({ upstream, browser: async (url, init) => {
    const request = new Request(`https://qa.invalid${url}`, init);
    const size = (await request.clone().arrayBuffer()).byteLength;
    largestRequest = Math.max(largestRequest, size);
    assert.ok(size < 4_500_000, 'request must fit the hosting body limit');
    return load('app/api/arquivos/multipart/route.ts')[init.method](request);
  } });
  const token = await load('app/lib/upload-document.ts').uploadDocument(new File([input], 'Manual.PDF'), p => progress.push(p));
  const payload = load('app/lib/upload-token.ts').verifyUploadToken(token, secret);
  assert.equal(payload.filename, 'Manual.PDF');
  assert.equal(payload.fileId, 'file-100mb');
  assert.equal(payload.size, input.length);
  assert.equal(parts.length, 34); assert.ok(completed);
  assert.ok(largestRequest > 3_000_000); assert.equal(progress.at(-1), 100);
});

test('multipart endpoints require authentication before contacting the provider', async () => {
  const route = loader({ access: 'unauthenticated', upstream: () => assert.fail('provider called') })('app/api/arquivos/multipart/route.ts');
  assert.equal((await route.POST(jsonRequest({ action: 'start', filename: 'a.pdf', size: 1 }))).status, 401);
  assert.equal((await route.PUT(new Request('https://qa.invalid/api', { method: 'PUT' }))).status, 401);
});

test('multipart sessions reject foreign accounts, tampering, expiry and invalid size before upload', async () => {
  const load = loader({ upstream: () => assert.fail('provider called') });
  const route = load('app/api/arquivos/multipart/route.ts');
  const sign = load('app/lib/multipart-token.ts').signMultipart;
  const session = { kind: 'multipart-session', uploadId: 'upload_a', filename: 'a.pdf', size: 1, owner: 'tester@example.invalid', expiresAt: Date.now() + 60000 };
  for (const token of [
    sign({ ...session, owner: 'other@example.invalid' }, secret),
    sign({ ...session, expiresAt: 0 }, secret),
    sign(session, secret) + 'changed',
  ]) assert.equal((await route.POST(jsonRequest({ action: 'cancel', session: token }))).status, 400);
  assert.equal((await route.POST(jsonRequest({ action: 'start', filename: 'a.pdf', size: limits.MAX_FILE_SIZE + 1 }))).status, 400);
});

test('completion rejects missing, reordered and foreign parts; receiving a wrong-sized chunk fails', async () => {
  const load = loader({ upstream: () => assert.fail('provider called') });
  const route = load('app/api/arquivos/multipart/route.ts');
  const sign = load('app/lib/multipart-token.ts').signMultipart;
  const session = { kind: 'multipart-session', uploadId: 'upload_a', filename: 'a.pdf', size: limits.UPLOAD_CHUNK_SIZE + 1, owner: 'tester@example.invalid', expiresAt: Date.now() + 60000 };
  const sessionToken = sign(session, secret);
  const receipt = (index, changes = {}) => sign({ ...session, kind: 'multipart-part', partId: `part_${index}`, index, size: index === 0 ? limits.UPLOAD_CHUNK_SIZE : 1, ...changes }, secret);
  for (const parts of [[receipt(0)], [receipt(1), receipt(0)], [receipt(0), receipt(1, { uploadId: 'upload_other' })]]) {
    assert.equal((await route.POST(jsonRequest({ action: 'complete', session: sessionToken, parts }))).status, 400);
  }
  const form = new FormData(); form.append('session', sessionToken); form.append('index', '0'); form.append('part', new File(['x'], 'part.bin'));
  assert.equal((await route.PUT(new Request('https://qa.invalid/api', { method: 'PUT', body: form }))).status, 400);
});

test('small files use the existing upload and multipart failures cancel the pending upload', async () => {
  const small = loader({ browser: async (url, init) => {
    assert.equal(url, '/api/arquivos'); assert.equal(init.body.get('arquivo').name, 'small.pdf');
    return Response.json({ token: 'small-token' });
  } });
  assert.equal(await small('app/lib/upload-document.ts').uploadDocument(new File(['pdf'], 'small.pdf')), 'small-token');
  const calls = [];
  const failed = loader({ browser: async (url, init) => {
    if (init.method === 'PUT') return Response.json({ error: 'Interrompido' }, { status: 502 });
    const body = JSON.parse(init.body); calls.push(body.action);
    return Response.json(body.action === 'start' ? { session: 'signed-session' } : { ok: true });
  } });
  await assert.rejects(failed('app/lib/upload-document.ts').uploadDocument(new File([Buffer.alloc(limits.UPLOAD_CHUNK_SIZE + 1)], 'large.pdf')), /Interrompido/);
  assert.deepEqual(calls, ['start', 'cancel']);
});
