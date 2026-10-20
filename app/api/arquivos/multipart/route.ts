import { getPortalAccess, portalAccessResponse } from "../../../lib/auth";
import { createUploadToken } from "../../../lib/upload-token";
import { signMultipart, verifyMultipart, type MultipartSession } from "../../../lib/multipart-token";
import { FILE_MIME_TYPES, FILE_SEARCH_EXTENSIONS, fileExtension, UPLOAD_CHUNK_SIZE, validateDocument } from "../../../lib/upload-limits";

export const runtime = "nodejs";
export const maxDuration = 60;

class UploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function upstream(path: string, apiKey: string, init: RequestInit) {
  const response = await fetch(`https://api.openai.com/v1/uploads${path}`, {
    ...init, headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
  });
  let data: any;
  try { data = await response.json(); } catch { throw new UploadError("O serviço de envio não respondeu como esperado. Tente novamente.", 502); }
  if (!response.ok) throw new UploadError(data?.error?.message || "Não foi possível enviar o documento.", 502);
  return data;
}

function json(body: object): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function checkSession(token: unknown, email: string, apiKey: string) {
  const session = verifyMultipart(token, "multipart-session", email, apiKey);
  validateDocument({ name: session.filename, size: session.size });
  return session;
}

function fail(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Não foi possível receber o documento." }, {
    status: error instanceof UploadError ? error.status : 400,
  });
}

export async function POST(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "O serviço de envio está indisponível." }, { status: 503 });
  try {
    const body = await request.json();
    if (body.action === "start") {
      validateDocument({ name: body.filename, size: body.size });
      const extension = fileExtension(body.filename);
      const filename = body.filename.slice(0, body.filename.lastIndexOf(".") + 1) + extension;
      const data = await upstream("", apiKey, json({
        filename, bytes: body.size, mime_type: FILE_MIME_TYPES[extension],
        purpose: FILE_SEARCH_EXTENSIONS.has(extension) ? "assistants" : extension.match(/^(png|jpg|jpeg|webp)$/) ? "vision" : "assistants",
        expires_after: { anchor: "created_at", seconds: 86400 },
      }));
      if (!/^upload_[\w-]+$/.test(data.id)) throw new UploadError("Não foi possível iniciar o envio.", 502);
      const session: MultipartSession = { kind: "multipart-session", uploadId: data.id, filename: body.filename,
        size: body.size, owner: access.email, expiresAt: Math.min(Date.now() + 60 * 60 * 1000, Number.isFinite(data.expires_at) ? data.expires_at * 1000 : Date.now() + 60 * 60 * 1000) };
      return Response.json({ session: signMultipart(session, apiKey) });
    }
    const session = checkSession(body.session, access.email, apiKey);
    if (body.action === "cancel") {
      await upstream(`/${session.uploadId}/cancel`, apiKey, json({}));
      return Response.json({ ok: true });
    }
    if (body.action !== "complete") throw new UploadError("Ação de envio inválida.");
    const expectedCount = Math.ceil(session.size / UPLOAD_CHUNK_SIZE);
    if (!Array.isArray(body.parts) || body.parts.length !== expectedCount) throw new UploadError("Faltam partes do documento. Envie novamente.");
    const parts = body.parts.map((token: unknown, index: number) => {
      const part = verifyMultipart(token, "multipart-part", access.email, apiKey);
      const expectedSize = Math.min(UPLOAD_CHUNK_SIZE, session.size - index * UPLOAD_CHUNK_SIZE);
      if (part.uploadId !== session.uploadId || part.index !== index || part.size !== expectedSize || !/^part_[\w-]+$/.test(part.partId)) {
        throw new UploadError("As partes do documento não correspondem ao envio.");
      }
      return part.partId;
    });
    const completed = await upstream(`/${session.uploadId}/complete`, apiKey, json({ part_ids: parts }));
    if (completed.status !== "completed" || !completed.file?.id || completed.bytes !== session.size || (completed.file.bytes != null && completed.file.bytes !== session.size)) {
      throw new UploadError("Não foi possível confirmar o documento completo.", 502);
    }
    return Response.json({ token: createUploadToken({ fileId: completed.file.id, filename: session.filename, size: session.size }, apiKey) });
  } catch (error) { return fail(error); }
}

export async function PUT(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "O serviço de envio está indisponível." }, { status: 503 });
  try {
    const form = await request.formData();
    const session = checkSession(form.get("session"), access.email, apiKey);
    const rawIndex = form.get("index");
    const index = typeof rawIndex === "string" && /^\d+$/.test(rawIndex) ? Number(rawIndex) : NaN;
    const part = form.get("part");
    if (!Number.isSafeInteger(index) || index < 0 || index >= Math.ceil(session.size / UPLOAD_CHUNK_SIZE) || !(part instanceof File)) {
      throw new UploadError("Parte de documento inválida.");
    }
    const expectedSize = Math.min(UPLOAD_CHUNK_SIZE, session.size - index * UPLOAD_CHUNK_SIZE);
    if (part.size !== expectedSize) throw new UploadError("A parte recebida possui tamanho incorreto. Envie novamente.");
    const outbound = new FormData(); outbound.append("data", part, "part.bin");
    const data = await upstream(`/${session.uploadId}/parts`, apiKey, { method: "POST", body: outbound });
    if (!/^part_[\w-]+$/.test(data.id)) throw new UploadError("Não foi possível confirmar a parte enviada.", 502);
    return Response.json({ part: signMultipart({ kind: "multipart-part", uploadId: session.uploadId, partId: data.id,
      index, size: part.size, owner: access.email, expiresAt: session.expiresAt }, apiKey) });
  } catch (error) { return fail(error); }
}
