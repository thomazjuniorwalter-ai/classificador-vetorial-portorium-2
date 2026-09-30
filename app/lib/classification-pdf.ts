import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { classificationReportSections, REPORT_TITLE, saveReportBlob, type ClassificationReport } from "./classification-report";

export async function createClassificationPdf(report: ClassificationReport, fontData?: { regular: Uint8Array; bold: Uint8Array }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(REPORT_TITLE); pdf.setAuthor("Portorium");
  pdf.registerFontkit(fontkit);
  if (!fontData) {
    const loadFont = async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error("Não foi possível carregar a fonte do relatório.");
      return new Uint8Array(await response.arrayBuffer());
    };
    const [regular, bold] = await Promise.all([loadFont("/fonts/DejaVuSans.ttf"), loadFont("/fonts/DejaVuSans-Bold.ttf")]);
    fontData = { regular, bold };
  }
  const regular = await pdf.embedFont(fontData.regular, { subset: true });
  const bold = await pdf.embedFont(fontData.bold, { subset: true });
  const supported = new Set(regular.getCharacterSet());
  const clean = (value: string) => Array.from(value.normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\t/g, " "))
    .map(char => char === "\n" || supported.has(char.codePointAt(0)!) ? char : `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`).join("");
  const width = 595.28, height = 841.89, margin = 44, bottom = 58;
  const ink = rgb(.20, .22, .25), red = rgb(.85, .14, .20);
  let page: PDFPage, y = 0;
  function newPage() {
    page = pdf.addPage([width, height]);
    page.drawRectangle({ x: 0, y: height - 76, width, height: 76, color: ink });
    page.drawText("PORTORIUM", { x: margin, y: height - 32, font: bold, size: 18, color: rgb(1, 1, 1) });
    page.drawText("Classificador Vetorial", { x: margin, y: height - 54, font: regular, size: 11, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: height - 79, width, height: 3, color: red });
    y = height - 108;
  }
  function wrap(value: string, font: PDFFont, size: number) {
    const lines: string[] = [];
    for (const paragraph of clean(value).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && font.widthOfTextAtSize(line + " " + word, size) > width - 2 * margin) { lines.push(line); line = ""; }
        if (font.widthOfTextAtSize(word, size) > width - 2 * margin) {
          for (const char of word) {
            if (font.widthOfTextAtSize(line + char, size) > width - 2 * margin) { lines.push(line); line = ""; }
            line += char;
          }
        } else line += (line ? " " : "") + word;
      }
      lines.push(line);
    }
    return lines;
  }
  function text(value: string, heading = false, title = false) {
    const size = title ? 18 : heading ? 12 : 11, leading = title ? 24 : heading ? 18 : 16;
    const font = heading || title ? bold : regular;
    if (heading || title) { if (y - 55 < bottom) newPage(); y -= 10; }
    for (const line of wrap(value, font, size)) {
      if (y - leading < bottom) newPage();
      page.drawText(line, { x: margin, y, font, size, color: heading ? red : ink }); y -= leading;
    }
    y -= 5;
  }
  newPage(); text(REPORT_TITLE, false, true);
  text("Resultado da análise técnica assistida da mercadoria, sujeito à revisão humana.");
  for (const section of classificationReportSections(report)) {
    text(section.title, true);
    for (const value of section.content) text(value);
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: margin, y: 44 }, end: { x: width - margin, y: 44 }, thickness: .6, color: rgb(.8, .8, .8) });
    p.drawText("PORTORIUM | Indicação técnica assistida - revisão humana necessária", { x: margin, y: 29, font: regular, size: 8, color: ink });
    p.drawText(`${index + 1}/${pages.length}`, { x: width - margin - 30, y: 29, font: regular, size: 8, color: ink });
  });
  return pdf.save();
}

export async function downloadClassificationPdf(report: ClassificationReport) {
  const bytes = await createClassificationPdf(report);
  saveReportBlob(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "pdf", report);
}
