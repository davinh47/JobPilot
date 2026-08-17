import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import PDFDocument from "pdfkit";
import {
  coverLetterSenderLines,
  cleanCoverLetterContent,
  coverLetterParagraphs,
  type CoverLetterDocumentMeta,
} from "@/lib/cover-letter-format";

type PdfFontSource = { path: string; family?: string };

const bundledCjkFont = join(process.cwd(), "assets/fonts/NotoSansCJKsc-Regular.otf");

const regularFontCandidates: PdfFontSource[] = [
  { path: bundledCjkFont },
  { path: "/System/Library/Fonts/PingFang.ttc", family: "PingFangSC-Regular" },
  { path: "/System/Library/Fonts/Hiragino Sans GB.ttc", family: "HiraginoSansGB-W3" },
  { path: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf" },
  { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
  { path: "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
  { path: "C:\\Windows\\Fonts\\arialuni.ttf" },
];

const baseFontCandidates = [
  bundledCjkFont,
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "C:\\Windows\\Fonts\\arialuni.ttf",
];

const emptyMeta: CoverLetterDocumentMeta = {
  identity: { fullName: "", headline: "", email: "", phone: "", location: "", links: "" },
  companyName: "",
  jobTitle: "",
  dateLabel: "",
};

function docxFont() {
  return { ascii: "Arial", hAnsi: "Arial", eastAsia: "PingFang SC", cs: "Arial", hint: "eastAsia" };
}

function firstFont(candidates: PdfFontSource[]) {
  return candidates.find((candidate) => existsSync(candidate.path));
}

export async function generateCoverLetterDocx(title: string, content: string, meta = emptyMeta) {
  const senderLines = coverLetterSenderLines(meta);
  const header = senderLines.map((line, index) => new Paragraph({
    children: [new TextRun({ text: line, color: "424944", size: 19, font: docxFont() })],
    spacing: { after: index === senderLines.length - 1 ? 700 : 18, line: 220 },
  }));
  const body = coverLetterParagraphs(cleanCoverLetterContent(content, meta)).map((text, index) => new Paragraph({
    alignment: AlignmentType.LEFT,
    children: text.split("\n").map((line, lineIndex) => new TextRun({
      text: line,
      break: lineIndex === 0 ? undefined : 1,
      font: docxFont(),
    })),
    spacing: { after: index === 0 ? 250 : 210, line: 300 },
  }));
  const document = new Document({
    title,
    creator: "JobPilot",
    styles: { default: { document: { run: { font: docxFont(), size: 21, color: "262B28" }, paragraph: { spacing: { after: 210, line: 300 } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 960, right: 1040, bottom: 960, left: 1040 } } },
      children: [
        ...header,
        ...body,
      ],
    }],
  });
  return Packer.toBuffer(document);
}

export async function generateCoverLetterPdf(title: string, content: string, meta = emptyMeta) {
  const regular = firstFont(regularFontCandidates);
  const baseFont = baseFontCandidates.find((candidate) => existsSync(candidate));
  if (!regular || !baseFont) throw new Error("No Unicode font is available for PDF export");
  const margin = 54;
  const document = new PDFDocument({
    size: "A4",
    margins: { top: margin, right: margin, bottom: margin, left: margin },
    font: baseFont,
    info: { Title: title, Creator: "JobPilot" },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  document.registerFont("LetterRegular", regular.path, regular.family);

  const contentWidth = document.page.width - margin * 2;
  const senderLines = coverLetterSenderLines(meta);
  const headerTop = margin;
  let leftY = headerTop;
  for (const line of senderLines) {
    document.font("LetterRegular").fontSize(9.5).fillColor("#424944").text(line, margin, leftY, {
      width: contentWidth,
      lineGap: 1.5,
    });
    leftY = document.y + 1.5;
  }
  document.x = margin;
  document.y = Math.max(leftY, headerTop + 22) + 76;

  for (const paragraph of coverLetterParagraphs(cleanCoverLetterContent(content, meta))) {
    const height = document.font("LetterRegular").fontSize(10.5).heightOfString(paragraph, {
      width: contentWidth,
      lineGap: 3.2,
    });
    if (document.y + height > document.page.height - margin && height < document.page.height - margin * 2) {
      document.addPage();
      document.x = margin;
      document.y = margin;
    }
    document.font("LetterRegular").fontSize(10.5).fillColor("#262B28").text(paragraph, margin, document.y, {
      width: contentWidth,
      align: "left",
      lineGap: 3.2,
    });
    document.moveDown(0.72);
  }
  document.end();
  return completed;
}
