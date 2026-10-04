import { getPortalAccess, portalAccessResponse } from '../../../lib/auth';
import { consultarProdutosSiscomex, validarConsultaSiscomex, ErroSiscomex } from '../../../lib/siscomex-consulta';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: Request) {
  const access = await getPortalAccess('classificador');
  if (access.status !== 'authorized') return portalAccessResponse(access);
  // Prevent another origin from submitting the user's secrets with their session.
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Origem da consulta inválida.' }, { status: 403, headers });
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ErroSiscomex('Envie os dados no formato JSON.', 400);
    const raw = await request.text();
    if (raw.length > 12000) throw new ErroSiscomex('Dados de consulta excedem o limite.', 400);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ErroSiscomex('Dados de consulta inválidos.', 400); }
    const input = validarConsultaSiscomex(body);
    const result = await consultarProdutosSiscomex(input);
    return Response.json({ ...result, ambiente: input.ambiente, consultadoEm: new Date().toISOString() }, { headers });
  } catch (e) {
    // Never return provider messages, credentials, tokens or raw transport errors.
    return Response.json({ error: e instanceof ErroSiscomex ? e.message : 'Não foi possível conectar ao Siscomex. Tente novamente mais tarde.' }, { status: e instanceof ErroSiscomex ? e.status : 502, headers });
  }
}
