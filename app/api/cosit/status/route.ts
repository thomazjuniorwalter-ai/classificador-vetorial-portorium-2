import { getPortalAccess, portalAccessResponse } from '../../../lib/auth';
import { getCositCatalog, catalogMetadata } from '../../../lib/cosit-catalog';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET() {
  const access=await getPortalAccess('classificador');
  if(access.status!=='authorized') return portalAccessResponse(access);
  return Response.json(catalogMetadata(await getCositCatalog()),{headers:{'Cache-Control':'private, no-store'}});
}
