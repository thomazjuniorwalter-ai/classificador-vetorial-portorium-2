import { verifyUploadToken } from "../../lib/upload-token";

export const runtime = "nodejs";
export const maxDuration = 300;

const PROMPT_ID = "pmpt_6a8c915448488195b7d29a0139bb18b1060faf2026a90e91";
const PROMPT_VERSION = "1";
const MAX_FILES = 10;
const MAX_TOTAL_FILE_SIZE = 50 * 1024 * 1024;

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "A chave da API ainda não foi configurada no servidor." }, { status: 503 });
  }

  let descricao = "";
  let documents: ReturnType<typeof verifyUploadToken>[] = [];
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
    const content: any[] = [
      {
        type: "input_text",
        text: `Analise conforme o Prompt e sustente a resposta apenas nas bases consultadas. Se faltarem dados ou houver alternativas plausíveis, reduza a confiança e declare as informações pendentes. A confiança é estimativa qualitativa de 0 a 100, não probabilidade estatística certificada.\n\nDescrição fornecida:\n${descricao || "Não fornecida; examine os documentos."}`,
      },
      ...documents.map((file) => ({ type: "input_file", file_id: file.fileId })),
    ];

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: { id: PROMPT_ID, version: PROMPT_VERSION },
        input: [{ role: "user", content }],
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
      return Response.json(
        { error: data?.error?.message || "A OpenAI não conseguiu concluir a análise." },
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
    await deleteDocuments(documents, apiKey);
  }
}
