import { getPortalAccess, portalAccessResponse } from "../../../lib/auth";
import { ErroPlanilha, lerPlanilhaTriagem } from "../../../lib/excel-triagem";
import { MAX_ARQUIVO_PLANILHA } from "../../../lib/triagem";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);

  const tamanhoDeclarado = Number(request.headers.get("content-length") || 0);
  if (tamanhoDeclarado > MAX_ARQUIVO_PLANILHA + 50_000) {
    return Response.json({ error: "A planilha deve ter no máximo 2 MB." }, { status: 413 });
  }

  let arquivo: File;
  try {
    const form = await request.formData();
    const entrada = form.get("planilha");
    if (!(entrada instanceof File)) throw new Error("Selecione uma planilha .xlsx.");
    arquivo = entrada;
  } catch {
    return Response.json({ error: "Não foi possível receber a planilha." }, { status: 400 });
  }
  if (!arquivo.name.toLowerCase().endsWith(".xlsx") || !arquivo.size || arquivo.size > MAX_ARQUIVO_PLANILHA) {
    return Response.json({ error: "Envie um arquivo .xlsx com até 2 MB." }, { status: 400 });
  }

  try {
    return Response.json(await lerPlanilhaTriagem(Buffer.from(await arquivo.arrayBuffer()), arquivo.name));
  } catch (error) {
    return Response.json({ error: error instanceof ErroPlanilha ? error.message :
      "Não foi possível ler a planilha. Verifique se ela é um .xlsx válido e sem proteção." }, { status: 400 });
  }
}
