import { getAuthenticatedUser } from "../../lib/auth";

const PROMPT_ID = "pmpt_6a8c915448488195b7d29a0139bb18b1060faf2026a90e91";
const PROMPT_VERSION = "1";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 10;

type OpenAIContent = { type?: string; text?: string };
type OpenAIOutput = { content?: OpenAIContent[] };
type OpenAIResponse = { output_text?: string; output?: OpenAIOutput[]; id?: string };

function outputText(response: OpenAIResponse) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
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
  required: ["classificacao", "ncm", "confianca", "descricaoAduaneira", "justificativa", "informacoesPendentes"],
  additionalProperties: false,
};

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return Response.json({ error: "Sua sessão expirou. Entre novamente." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "A chave da API ainda não foi configurada no servidor." }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const descricao = String(form.get("descricao") ?? "").trim();
    const files = form
      .getAll("documentos")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (!descricao && files.length === 0) {
      return Response.json({ error: "Informe a mercadoria ou anexe pelo menos um documento." }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return Response.json({ error: `Envie no máximo ${MAX_FILES} documentos por análise.` }, { status: 400 });
    }
    if (files.some((file) => file.size > MAX_FILE_SIZE)) {
      return Response.json({ error: "Cada documento deve ter no máximo 10 MB." }, { status: 400 });
    }

    const content: Array<Record<string, string>> = [
      {
        type: "input_text",
        text: `Analise conforme o Prompt e sustente a resposta apenas nas bases consultadas. Se faltarem dados ou houver alternativas plausíveis, reduza a confiança e declare as informações pendentes. A confiança é estimativa qualitativa de 0 a 100, não probabilidade estatística certificada.\n\nDescrição fornecida:\n${descricao || "Não fornecida; examine os documentos."}`,
      },
    ];

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      content.push({
        type: "input_file",
        filename: file.name,
        file_data: `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`,
      });
    }

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: { id: PROMPT_ID, version: PROMPT_VERSION },
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "classificacao_fiscal", strict: true, schema: resultSchema } },
      }),
    });

    const data = (await apiResponse.json()) as OpenAIResponse & { error?: { message?: string } };
    if (!apiResponse.ok) {
      return Response.json({ error: data.error?.message || "A OpenAI não conseguiu concluir a análise." }, { status: apiResponse.status });
    }

    const text = outputText(data);
    if (!text) return Response.json({ error: "A análise terminou sem uma resposta textual." }, { status: 502 });

    try {
      return Response.json({ result: JSON.parse(text), responseId: data.id });
    } catch {
      return Response.json({ error: "A resposta não estava no formato técnico esperado." }, { status: 502 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro inesperado durante a análise." }, { status: 500 });
  }
}
