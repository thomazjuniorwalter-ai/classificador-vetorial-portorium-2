import ExcelJS from 'exceljs';
import { verificarTamanhoZip } from './excel-triagem.ts';
export async function lerPlanilhaCatalogo(bytes: Buffer) {
  verificarTamanhoZip(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets.find(s => s.actualRowCount > 1);
  if (!sheet) throw new Error('Não há produtos na planilha.');
  const cabecalho = sheet.getRow(1);
  if (cabecalho.cellCount > 100) throw new Error('Use até 100 colunas.');
  const nomes: string[] = [];
  cabecalho.eachCell({ includeEmpty: true }, (cell, n) => {
    if (cell.formula || cell.type === ExcelJS.ValueType.Formula) throw new Error('Cole os valores das fórmulas antes de enviar.');
    nomes[n - 1] = cell.text.trim();
  });
  const colunaNcm = nomes.findIndex(n => n.toLowerCase() === 'ncm');
  if (colunaNcm < 0) throw new Error('Inclua uma coluna NCM. Use Denominação, Descrição e códigos ATT_… como demais títulos.');
  const produtos: any[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1) return;
    const produto: any = { modalidade: 'IMPORTACAO', atributos: [], atributosMultivalorados: [] };
    let temValor = false;
    nomes.forEach((nome, index) => {
      const cell = row.getCell(index + 1);
      if (cell.formula || cell.type === ExcelJS.ValueType.Formula) throw new Error(`Linha ${numero}: cole os valores das fórmulas.`);
      const texto = cell.text.trim();
      if (texto.length > 3700) throw new Error(`Linha ${numero}: uma célula ultrapassa 3.700 caracteres.`);
      temValor ||= !!texto;
      if (index === colunaNcm) produto.ncm = typeof cell.value === 'number' && Number.isInteger(cell.value) && cell.value >= 0 ? String(cell.value).padStart(8, '0') : texto;
      else if (['denominação', 'denominacao', 'produto'].includes(nome.toLowerCase())) produto.denominacao = texto;
      else if (['descrição', 'descricao'].includes(nome.toLowerCase())) produto.descricao = texto;
      else if (/^ATT_\d+$/.test(nome) && texto) {
        const valores = texto.split('|').map(v => v.trim());
        if (valores.length > 1) produto.atributosMultivalorados.push({ codigo: nome, valores });
        else produto.atributos.push({ codigo: nome, valor: texto });
      }
    });
    if (temValor) produtos.push(produto);
    if (produtos.length > 50) throw new Error('Envie até 50 produtos por arquivo.');
  });
  if (!produtos.length) throw new Error('Não há produtos na planilha.');
  return produtos;
}
