const PROMPT_ID = "pmpt_6a8c915448488195b7d29a0139bb18b1060faf2026a90e91";
const PROMPT_VERSION = "1";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function outputText(response: any) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((item: any) => item.type === "output_text")
    .map((item: any) => item.text)
    .join("\n");
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "A chave da API ainda não foi configurada no servidor." }, { status: 503 });

  try {
    const form = await request.formData();
    const descricao = String(form.get("descricao") ?? "").trim();
    const files = form.getAll("documentos").filter((value): value is File => value instanceof File && value.size > 0);
    if (!descricao && files.length === 0) return Response.json({ error: "Informe a mercadoria ou anexe pelo menos um documento." }, { status: 400 });
    if (files.length > 6) return Response.json({ error: "Envie no máximo 6 documentos por análise." }, { status: 400 });
    if (files.some(file => file.size > MAX_FILE_SIZE)) return Response.json({ error: "Cada documento deve ter no máximo 20 MB." }, { status: 400 });

    const content: any[] = [{
      type: "input_text",
      text: `Analise a mercadoria e produza a classificação fiscal fundamentada, as informações pendentes e a descrição aduaneira conforme suas instruções.\n\nDescrição fornecida pelo usuário:\n${descricao || "Não fornecida; examine os documentos."}`,
    }];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      content.push({ type: "input_file", filename: file.name, file_data: `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}` });
    }

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: { id: PROMPT_ID, version: PROMPT_VERSION }, input: [{ role: "user", content }] }),
    });
    const data: any = await apiResponse.json();
    if (!apiResponse.ok) return Response.json({ error: data?.error?.message || "A OpenAI não conseguiu concluir a análise." }, { status: apiResponse.status });
    const text = outputText(data);
    if (!text) return Response.json({ error: "A análise terminou sem uma resposta textual." }, { status: 502 });
    return Response.json({ result: text, responseId: data.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro inesperado durante a análise." }, { status: 500 });
  }
}
