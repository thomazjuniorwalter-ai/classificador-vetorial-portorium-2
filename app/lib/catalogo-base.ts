import { inflateRawSync } from 'node:zlib';
import { FONTE_CATALOGO, type BaseOficial, regrasPorNcm } from './catalogo.ts';
export function lerJsonOficialZip(bytes: Buffer): BaseOficial {
  // Central directory supplies sizes even when local headers use data descriptors.
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50) { end = p; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 10) !== 1) throw new Error('Arquivo oficial ZIP inesperado.');
  const central = bytes.readUInt32LE(end + 16);
  if (central + 46 > bytes.length || bytes.readUInt32LE(central) !== 0x02014b50) throw new Error('Arquivo oficial incompleto.');
  const compressed = bytes.readUInt32LE(central + 20), size = bytes.readUInt32LE(central + 24), local = bytes.readUInt32LE(central + 42);
  if (size > 30 * 1024 * 1024 || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(central + 10) !== 8) throw new Error('Formato oficial não suportado.');
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  if (start + compressed > bytes.length) throw new Error('Arquivo oficial incompleto.');
  const json = inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: 30 * 1024 * 1024 });
  if (json.length !== size) throw new Error('Arquivo oficial com tamanho inconsistente.');
  const base = JSON.parse(json.toString('utf8'));
  if (!base.versao || !Array.isArray(base.listaNcm) || !Array.isArray(base.detalhesAtributos)) throw new Error('A base oficial mudou de formato.');
  return base;
}
let cache: { base: BaseOficial; expires: number } | undefined;
let pending: Promise<BaseOficial> | undefined;
export async function carregarBaseCatalogo(): Promise<BaseOficial> {
  if (cache && cache.expires > Date.now()) return cache.base;
  if (!pending) pending = (async () => {
    const response = await fetch(FONTE_CATALOGO, { cache: 'no-store', signal: AbortSignal.timeout(40000) });
    if (!response.ok) throw new Error('A base oficial está indisponível. Tente novamente mais tarde.');
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw new Error('Arquivo oficial excede o limite.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Arquivo oficial excede o limite.');
    const base = lerJsonOficialZip(bytes);
    cache = { base, expires: Date.now() + 60 * 60 * 1000 };
    return base;
  })().finally(() => { pending = undefined; });
  return pending;
}
export async function consultarRegrasCatalogo(ncm: unknown) {
  const data = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return regrasPorNcm(await carregarBaseCatalogo(), ncm, data);
}
