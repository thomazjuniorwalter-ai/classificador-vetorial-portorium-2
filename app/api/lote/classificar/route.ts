import { retrieveCosit, cositInstructions } from "../../../lib/cosit-retrieval";
import { normativeInstructions } from "../../../lib/classification-grounding";
import { getPortalAccess, portalAccessResponse } from "../../../lib/auth";
import { PROMPT_ID, PROMPT_VERSION } from "../../../lib/classificador-prompt";
import { normalizarNcm } from "../../../lib/triagem";

export const runtime = "nodejs";
export const maxDuration = 180;

const schema = {
  type: "object",
  properties: {
    ncm: { type: "string", description: "NCM sugerida com oito algarismos; vazia se os dados não permitirem sugerir uma NCM." },
    confianca: {
      type: "integer", minimum: 0, maximum: 100,
      description: "Estimativa qualitativa prudente, sem calibração estatística.",
    },
  },
  required: ["ncm", "confianca"],
  additionalProperties: false,
};

function extrairTexto(data: any): string {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output ?? []).flatMap((item: any) => item.content ?? [])
    .filter((item: any) => item.type === "output_text")
    .map((item: any) => item.text).join("\n");
}

export async function POST(request: Request) {
  const access = await getPortalAccess("classificador");
  if (access.status !== "authorized") return portalAccessResponse(access);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "A chave da API não está configurada no servidor." }, { status: 503 });

  let descricao: string;
  try {
    const body = await request.json();
    // A NCM do cliente não faz parte desta rota nem é repassada ao modelo.
    descricao = typeof body?.descricao === "string" ? body.descricao.trim() : "";
  } catch {
    return Response.json({ error: "Solicitação inválida." }, { status: 400 });
  }
  if (descricao.length < 10 || descricao.length > 2_500) {
    return Response.json({ error: "Descreva a mercadoria em 10 a 2.500 caracteres." }, { status: 400 });
  }

  try {
    const cosit = await retrieveCosit(descricao, key);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: { id: PROMPT_ID, version: PROMPT_VERSION },
        store: false,
        input: [{ role: "developer", content: normativeInstructions + "\n" + cositInstructions }, { role: "user", content: [{
          type: "input_text",
          text: `Faça uma classificação independente da mercadoria abaixo, seguindo o mesmo método do Classificador Portorium. A NCM informada pelo cliente não está disponível nesta consulta. Responda somente com a NCM sugerida e a confiança qualitativa estimada de 0 a 100. Se os dados não permitirem determinar uma NCM, devolva ncm vazia e confiança 0. Não produza justificativa, descrição aduaneira ou informações adicionais.\n\nInformações técnicas da mercadoria:\n${descricao}\n\n${cosit.context}`,
        }] }],
        text: { format: { type: "json_schema", name: "triagem_classificacao", strict: true, schema } },
      }),
    });
    const data: any = await response.json();
    if (!response.ok) {
      console.error("[triagem-lote] Falha na API de classificação", {
        status: response.status,
        codigo: data?.error?.code,
        tipo: data?.error?.type,
        requisicao: response.headers.get("x-request-id"),
      });
      return Response.json({ error: data?.error?.message || "A análise desta mercadoria falhou." }, { status: response.status });
    }
    const texto = extrairTexto(data);
    if (!texto) return Response.json({ error: "A análise terminou sem resultado." }, { status: 502 });
    const resultado = JSON.parse(texto);
    const ncm = normalizarNcm(resultado?.ncm);
    if (!Number.isInteger(resultado?.confianca) || resultado.confianca < 0 || resultado.confianca > 100) {
      return Response.json({ error: "A confiança foi devolvida em formato inválido." }, { status: 502 });
    }
    if (resultado.ncm && !ncm) {
      return Response.json({ error: "A NCM sugerida veio em formato inválido." }, { status: 502 });
    }
    return Response.json({ ncm: ncm || "", confianca: ncm ? resultado.confianca : 0, cositRetrievalStatus: cosit.status, cositRetrievalMode: cosit.mode, cositMetadata: cosit.metadata });
  } catch (problema) {
    console.error("[triagem-lote] Falha inesperada", problema instanceof Error ? problema.name : "erro desconhecido");
    return Response.json({ error: "Não foi possível concluir esta mercadoria. Tente novamente." }, { status: 502 });
  }
}
