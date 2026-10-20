import { UPLOAD_CHUNK_SIZE, validateDocument } from "./upload-limits";

async function readUpload(response: Response) {
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error("Não foi possível enviar o documento. Confira a conexão e tente novamente."); }
  if (!response.ok) throw new Error(data.error || "Não foi possível enviar o documento.");
  return data;
}

export async function uploadDocument(file: File, progress: (percent: number) => void = () => {}) {
  validateDocument(file);
  progress(0);
  if (file.size <= UPLOAD_CHUNK_SIZE) {
    const form = new FormData(); form.append("arquivo", file);
    const data = await readUpload(await fetch("/api/arquivos", { method: "POST", body: form }));
    if (!data.token) throw new Error("O envio não retornou uma referência válida.");
    progress(100);
    return data.token as string;
  }

  let session = "";
  const action = async (body: object) => readUpload(await fetch("/api/arquivos/multipart", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  try {
    const started = await action({ action: "start", filename: file.name, size: file.size });
    if (!started.session) throw new Error("Não foi possível iniciar o envio.");
    session = started.session;
    const parts: string[] = [];
    for (let offset = 0, index = 0; offset < file.size; offset += UPLOAD_CHUNK_SIZE, index += 1) {
      const form = new FormData();
      form.append("session", session); form.append("index", String(index));
      form.append("part", file.slice(offset, offset + UPLOAD_CHUNK_SIZE), "part.bin");
      const data = await readUpload(await fetch("/api/arquivos/multipart", { method: "PUT", body: form }));
      if (!data.part) throw new Error("Não foi possível confirmar uma parte do documento.");
      parts.push(data.part);
      progress(Math.min(99, Math.floor(Math.min(offset + UPLOAD_CHUNK_SIZE, file.size) / file.size * 100)));
    }
    const completed = await action({ action: "complete", session, parts });
    if (!completed.token) throw new Error("O envio não retornou uma referência válida.");
    session = "";
    progress(100);
    return completed.token as string;
  } catch (error) {
    if (session) await action({ action: "cancel", session }).catch(() => undefined);
    throw error;
  }
}
