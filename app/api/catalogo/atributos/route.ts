import { getPortalAccess, portalAccessResponse } from '../../../lib/auth';
import { consultarRegrasCatalogo } from '../../../lib/catalogo-base';
import { normalizarNcmCatalogo } from '../../../lib/catalogo';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const access = await getPortalAccess('classificador');
  if (access.status !== 'authorized') return portalAccessResponse(access);
  let ncm: string;
  try { ncm = normalizarNcmCatalogo(new URL(request.url).searchParams.get('ncm')); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  try { return Response.json(await consultarRegrasCatalogo(ncm), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 503 }); }
}
