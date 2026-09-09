import { createUploadToken, verifyUploadToken } from "../../lib/upload-token";
import { getPortalAccess, portalAccessResponse } from "../../lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "md", "png", "jpg", "jpeg", "webp",
];
const FILE_SEARCH_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md"]);

async function readJson(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Serviço externo respondeu em formato inesperado (${response.status}).`);
  }
}

export async function POST(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "A chave da API ainda não foi configurada no servidor." }, { status: 503 });

  let file: File;
  try {
    const form = await request.formData();
    const value = form.get("arquivo");
    if (!(value instanceof File) || value.size === 0) {
      return Response.json({ error: "Selecione um documento válido." }, { status: 400 });
    }
    file = value;
  } catch {
    return Response.json({ error: "Não foi possível receber o documento." }, { status: 400 });
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return Response.json({ error: `O formato de ${file.name} não é compatível.` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: `O arquivo ${file.name} ultrapassa o limite de 10 MB.` }, { status: 400 });
  }

  try {
    const form = new FormData();
    // Documentos longos são pesquisados por recuperação vetorial, evitando
    // que o texto integral de todos os anexos ocupe a janela de contexto.
    // Planilhas e imagens continuam como input_file, pois não são aceitas
    // pelo File Search.
    form.append("purpose", FILE_SEARCH_EXTENSIONS.has(extension) ? "assistants" : "user_data");
    form.append("file", file, file.name);
    const upload = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const payload = await readJson(upload);
    if (!upload.ok || !payload.id) {
      return Response.json(
        { error: payload?.error?.message || `Não foi possível enviar ${file.name}.` },
        { status: upload.status || 502 }
      );
    }
    return Response.json({
      token: createUploadToken({ fileId: payload.id, filename: file.name, size: file.size }, apiKey),
      filename: file.name,
      size: file.size,
    });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : `Não foi possível enviar ${file.name}.` },
      { status: 502 }
    );
  }
}

export async function DELETE(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ ok: false }, { status: 503 });
  try {
    const body = await request.json();
    const tokens = Array.isArray(body?.tokens) ? body.tokens.slice(0, 10) : [];
    const fileIds = tokens.map((token: unknown) => verifyUploadToken(token, apiKey).fileId);
    await Promise.allSettled(
      fileIds.map((fileId: string) =>
        fetch(`https://api.openai.com/v1/files/${fileId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiKey}` },
        })
      )
    );
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
}
