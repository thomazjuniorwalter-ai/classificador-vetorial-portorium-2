import { verifyUploadToken } from "./upload-token";
const VECTOR_POLL_INTERVAL_MS = 1_000;
const VECTOR_POLL_LIMIT = 90;

export async function openAiJson(url: string, apiKey: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data: any = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Falha ao preparar os documentos para pesquisa.");
  return data;
}

export async function createTemporaryVectorStore(
  documents: ReturnType<typeof verifyUploadToken>[],
  apiKey: string
) {
  if (documents.length === 0) return null;
  const store = await openAiJson("https://api.openai.com/v1/vector_stores", apiKey, {
    method: "POST",
    body: JSON.stringify({ name: `analise-temporaria-${Date.now()}` }),
  });
  try {
    await Promise.all(
      documents.map((file) =>
        openAiJson(`https://api.openai.com/v1/vector_stores/${store.id}/files`, apiKey, {
          method: "POST",
          body: JSON.stringify({ file_id: file.fileId }),
        })
      )
    );

    for (let attempt = 0; attempt < VECTOR_POLL_LIMIT; attempt += 1) {
      const listed = await openAiJson(
        `https://api.openai.com/v1/vector_stores/${store.id}/files?limit=100`,
        apiKey
      );
      const statuses = (listed.data ?? []).map((file: any) => file.status);
      if (statuses.length === documents.length && statuses.every((status: string) => status === "completed")) {
        return store.id as string;
      }
      if (statuses.some((status: string) => status === "failed" || status === "cancelled")) {
        throw new Error("Um dos documentos não pôde ser indexado para pesquisa.");
      }
      await new Promise((resolve) => setTimeout(resolve, VECTOR_POLL_INTERVAL_MS));
    }
    throw new Error("A preparação dos documentos demorou além do esperado. Tente novamente.");
  } catch (error) {
    await deleteVectorStore(store.id, apiKey);
    throw error;
  }
}

export async function deleteVectorStore(vectorStoreId: string | null, apiKey: string) {
  if (!vectorStoreId) return;
  await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined);
}

export async function deleteDocuments(documents: ReturnType<typeof verifyUploadToken>[], apiKey: string) {
  await Promise.allSettled(
    documents.map((file) =>
      fetch(`https://api.openai.com/v1/files/${file.fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    )
  );
}

export function outputText(response: any) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((item: any) => item.type === "output_text")
    .map((item: any) => item.text)
    .join("\n");
}

