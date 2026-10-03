import { lerPlanilhaCatalogo } from "../../../lib/catalogo-planilha";
import { getPortalAccess, portalAccessResponse } from '../../../lib/auth';
import { carregarBaseCatalogo } from '../../../lib/catalogo-base';
import { avaliarCadastro, importarProdutosJson, regrasPorNcm, valoresDoProduto } from '../../../lib/catalogo';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const access = await getPortalAccess('classificador');
  if (access.status !== 'authorized') return portalAccessResponse(access);
  let produtos: any[];
  try {
    if (Number(request.headers.get('content-length')) > 2 * 1024 * 1024 + 50000) throw new Error('O arquivo deve ter no máximo 2 MB.');
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData(), file = form.get('arquivo');
      if (!(file instanceof File) || file.size > 2 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Envie uma planilha .xlsx com até 2 MB.');
      produtos = await lerPlanilhaCatalogo(Buffer.from(await file.arrayBuffer()));
    } else {
      const raw = await request.text();
      if (raw.length > 2 * 1024 * 1024) throw new Error('O arquivo deve ter no máximo 2 MB.');
      produtos = importarProdutosJson(JSON.parse(raw));
    }
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  try {
    const base = await carregarBaseCatalogo();
    const data = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const resultados = produtos.map((produto, index) => {
      const nome = String(produto.denominacao || produto.descricao || `Produto ${index + 1}`).slice(0, 200);
      try {
        if (produto.modalidade && produto.modalidade !== 'IMPORTACAO') throw new Error('Produto de exportação: auditoria disponível apenas para importação.');
        const regras = regrasPorNcm(base, produto.ncm, data), valores = valoresDoProduto(produto);
        for (const campo of regras.campos) if (campo.pai && valores[campo.codigo]) valores[campo.chave] = valores[campo.codigo];
        const avaliacao = avaliarCadastro(regras, valores);
        const achados: string[] = [];
        if (!String(produto.denominacao ?? '').trim()) achados.push('Denominação ausente.');
        if (String(produto.denominacao ?? '').length > 120) achados.push('Denominação ultrapassa 120 caracteres.');
        if (!String(produto.descricao ?? '').trim()) achados.push('Descrição complementar ausente.');
        if (String(produto.descricao ?? '').length > 3700) achados.push('Descrição ultrapassa 3700 caracteres.');
        if (produto.situacao && produto.situacao !== 'ATIVADO') achados.push(`Situação informada: ${produto.situacao}.`);
        if (produto.atributosCompostos?.length || produto.atributosCompostosMultivalorados?.length) achados.push('Estruturas compostas exigem revisão manual nesta etapa.');
        for (const c of avaliacao.campos) {
          const label = c.campo.nomeApresentacao || c.campo.nome;
          if (c.estado === 'condicao_pendente') achados.push(`${label}: condição de preenchimento ainda não resolvida.`);
          if (c.estado === 'invalido') achados.push(`${label}: ${c.erros.join(' ')}`);
          if (c.ativa === true && c.campo.obrigatorio && !c.valores.length) achados.push(`${label}: obrigatório não preenchido.`);
          if (c.ativa === false && c.valores.length) achados.push(`${label}: valor informado apesar de condição não aplicável.`);
        }
        for (const codigo of Object.keys(valores)) if (!regras.campos.some(c => c.codigo === codigo || c.chave === codigo)) achados.push(`${codigo}: não pertence aos atributos de produto vigentes desta NCM.`);
        achados.push(...regras.avisos);
        return { nome, ncm: regras.ncm, codigo: produto.codigo ?? null, versaoProduto: produto.versao ?? null, completude: avaliacao.completude, achados, status: achados.length ? 'pendencias' : 'revisao_tecnica', valores, descricao: String(produto.descricao ?? '') };
      } catch (error) { return { nome, ncm: String(produto.ncm ?? ''), status: 'erro', achados: [(error as Error).message] }; }
    });
    return Response.json({ versaoBase: base.versao, auditadoEm: new Date().toISOString(), resultados }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: 'Não foi possível consultar a base oficial. Tente novamente.' }, { status: 503 }); }
}
