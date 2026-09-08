import { verifyUploadToken } from "../../lib/upload-token";
import { getPortalAccess, portalAccessResponse } from "../../lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const PROMPT_ID = "pmpt_6a8c915448488195b7d29a0139bb18b1060faf2026a90e91";
const PROMPT_VERSION = "1";
const MAX_FILES = 10;
const MAX_TOTAL_FILE_SIZE = 50 * 1024 * 1024;
const FILE_SEARCH_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md"]);
const VECTOR_POLL_INTERVAL_MS = 1_000;
const VECTOR_POLL_LIMIT = 90;

function extension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

async function openAiJson(url: string, apiKey: string, init: RequestInit = {}) {
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

async function createTemporaryVectorStore(
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

async function deleteVectorStore(vectorStoreId: string | null, apiKey: string) {
  if (!vectorStoreId) return;
  await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined);
}

async function deleteDocuments(documents: ReturnType<typeof verifyUploadToken>[], apiKey: string) {
  await Promise.allSettled(
    documents.map((file) =>
      fetch(`https://api.openai.com/v1/files/${file.fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    )
  );
}

function outputText(response: any) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((item: any) => item.type === "output_text")
    .map((item: any) => item.text)
    .join("\n");
}

const resultSchema = {
  type: "object",
  properties: {
    classificacao: { type: "string" },
    ncm: { type: "string" },
    confianca: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Estimativa prudente de confiança; não é probabilidade estatística calibrada.",
    },
    descricaoAduaneira: { type: "string" },
    justificativa: { type: "string" },
    informacoesPendentes: { type: "string" },
  },
  required: [
    "classificacao",
    "ncm",
    "confianca",
    "descricaoAduaneira",
    "justificativa",
    "informacoesPendentes",
  ],
  additionalProperties: false,
};

export async function POST(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "A chave da API ainda não foi configurada no servidor." }, { status: 503 });
  }

  let descricao = "";
  let documents: ReturnType<typeof verifyUploadToken>[] = [];
  let vectorStoreId: string | null = null;
  try {
    const body = await request.json();
    descricao = String(body?.descricao ?? "").trim();
    const tokens = Array.isArray(body?.documentos) ? body.documentos : [];
    if (tokens.length > MAX_FILES) {
      return Response.json({ error: `Envie no máximo ${MAX_FILES} documentos por análise.` }, { status: 400 });
    }
    documents = tokens.map((token: unknown) => verifyUploadToken(token, apiKey));
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "Solicitação inválida." },
      { status: 400 }
    );
  }

  if (!descricao && documents.length === 0) {
    return Response.json({ error: "Informe a mercadoria ou anexe pelo menos um documento." }, { status: 400 });
  }
  if (documents.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_FILE_SIZE) {
    await deleteDocuments(documents, apiKey);
    return Response.json(
      { error: "O conjunto dos documentos deve ter no máximo 50 MB. Remova um arquivo e tente novamente." },
      { status: 400 }
    );
  }

  try {
    const searchableDocuments = documents.filter((file) => FILE_SEARCH_EXTENSIONS.has(extension(file.filename)));
    const directDocuments = documents.filter((file) => !FILE_SEARCH_EXTENSIONS.has(extension(file.filename)));
    vectorStoreId = await createTemporaryVectorStore(searchableDocuments, apiKey);

    const content: any[] = [
      {
        type: "input_text",
        text: `Analise conforme o Prompt e sustente a resposta apenas nas bases consultadas. Se faltarem dados ou houver alternativas plausíveis, reduza a confiança e declare as informações pendentes. A confiança é estimativa qualitativa de 0 a 100, não probabilidade estatística certificada.\n\nDescrição fornecida:\n${descricao || "Não fornecida; examine os documentos."}`,
      },
      ...directDocuments.map((file) => ({ type: "input_file", file_id: file.fileId })),
    ];

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: { id: PROMPT_ID, version: PROMPT_VERSION },
        input: [{ role: "user", content }],
        ...(vectorStoreId
          ? {
              tools: [
                {
                  type: "file_search",
                  vector_store_ids: [vectorStoreId],
                  max_num_results: 20,
                },
              ],
            }
          : {}),
        text: {
          format: {
            type: "json_schema",
            name: "classificacao_fiscal",
            strict: true,
            schema: resultSchema,
          },
        },
      }),
    });
    const data: any = await apiResponse.json();
    if (!apiResponse.ok) {
      const apiMessage = data?.error?.message || "A OpenAI não conseguiu concluir a análise.";
      const friendlyMessage = /context window|context length|too many tokens/i.test(apiMessage)
        ? "Os documentos ainda contêm conteúdo demais para uma única análise. Remova arquivos repetidos ou divida a análise em dois grupos."
        : apiMessage;
      return Response.json(
        { error: friendlyMessage },
        { status: apiResponse.status }
      );
    }
    const text = outputText(data);
    if (!text) return Response.json({ error: "A análise terminou sem uma resposta textual." }, { status: 502 });
    try {
      return Response.json({ result: JSON.parse(text), responseId: data.id });
    } catch {
      return Response.json({ error: "A resposta não estava no formato técnico esperado." }, { status: 502 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Erro inesperado durante a análise." },
      { status: 500 }
    );
  } finally {
    await deleteVectorStore(vectorStoreId, apiKey);
    await deleteDocuments(documents, apiKey);
  }
}
