import { Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, TextRun, AlignmentType } from "docx";
import { classificationReportSections, REPORT_TITLE, saveReportBlob, type ClassificationReport } from "./classification-report";

export async function createClassificationWord(report: ClassificationReport) {
  const children: Paragraph[] = [
    new Paragraph({ text: REPORT_TITLE, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "Resultado da análise técnica assistida da mercadoria, sujeito à revisão humana." }),
  ];
  for (const section of classificationReportSections(report)) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));
    for (const value of section.content) {
      for (const line of value.split("\n")) children.push(new Paragraph({ text: line }));
    }
  }
  const document = new Document({
    creator: "Portorium", title: REPORT_TITLE,
    styles: {
      default: { document: { run: { font: "Arial", size: 22 }, paragraph: { spacing: { after: 140, line: 280 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 36, bold: true, color: "000000" }, paragraph: { spacing: { before: 180, after: 240 }, keepNext: true } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 25, bold: true, color: "D92333" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 0 } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "PORTORIUM", bold: true, size: 24, color: "393C42" }), new TextRun({ text: "  |  Classificador Vetorial", size: 18, color: "666666" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Análise assistida | Página ", size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: " de ", size: 16 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 })] })] }) },
      children,
    }],
  });
  return Packer.toBlob(document);
}

export async function downloadClassificationWord(report: ClassificationReport) {
  saveReportBlob(await createClassificationWord(report), "docx", report);
}
