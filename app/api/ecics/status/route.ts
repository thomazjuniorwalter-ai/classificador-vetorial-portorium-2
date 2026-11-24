import { getPortalAccess, portalAccessResponse } from "../../../lib/auth";
import { getEcicsStatus } from "../../../lib/ecics-retrieval";

export const runtime = "nodejs";

export async function GET() {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);
  return Response.json(await getEcicsStatus(), { headers: { "Cache-Control": "private, no-store" } });
}
