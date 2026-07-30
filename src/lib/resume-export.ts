import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import PDFDocument from "pdfkit";
import { normalizePlatformResume, type PlatformResume, type ResumeEntry, type ResumeSectionType } from "@/lib/resume-format";

export const resumeTemplates = ["classic", "modern", "compact"] as const;
export type ResumeTemplate = (typeof resumeTemplates)[number];

type TemplateTokens = {
  accent: string;
  bodyFont: string;
  bodySize: number;
  bodySpacing: number;
  headingSize: number;
  nameSize: number;
  margin: number;
};

type DisplaySection = { type: ResumeSectionType; title: string; content: string; entries: ResumeEntry[] };
type ContentLine = { kind: "blank" | "bullet" | "entry" | "meta" | "body"; text: string; date?: string };
export type ResumeEntryPresentation = {
  primary: string;
  secondary: string;
  date: string;
  description: string;
  highlights: string[];
};

function docxFonts(westernFont: string) {
  return { ascii: westernFont, hAnsi: westernFont, eastAsia: "PingFang SC", cs: "PingFang SC" };
}

const templateTokens: Record<ResumeTemplate, TemplateTokens> = {
  classic: { accent: "263238", bodyFont: "Times New Roman", bodySize: 18, bodySpacing: 56, headingSize: 21, nameSize: 38, margin: 760 },
  modern: { accent: "176B52", bodyFont: "Arial", bodySize: 18, bodySpacing: 54, headingSize: 20, nameSize: 40, margin: 720 },
  compact: { accent: "294E63", bodyFont: "Arial", bodySize: 17, bodySpacing: 42, headingSize: 19, nameSize: 35, margin: 680 },
};

const bulletPattern = /^\s*[-*\u2022]\s+/;
const monthName = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?";
const datedValue = `(?:(?:${monthName}\\s+)?(?:19|20)\\d{2}|(?:19|20)\\d{2}年(?:\\d{1,2}月)?)`;
const datePattern = new RegExp(`^(.*?)\\s+(${datedValue}\\s*[-\\u2013\\u2014]\\s*(?:Present|Current|Now|至今|目前|在职|${datedValue}))$`, "i");

function contentLines(content: string) {
  return content.replace(/\r/g, "").split("\n").filter((line) => !/^\s*--?\s*\d+\s+of\s+\d+\s*--?\s*$/i.test(line));
}

function containsCjk(text: string) {
  return /[\u2e80-\u9fff\uf900-\ufaff]/.test(text);
}

function isLinkLike(value: string) {
  return /(?:https?:\/\/|www\.|linkedin\s*:|github\s*:)/i.test(value);
}

function effectiveHeadline(resume: PlatformResume) {
  return isLinkLike(resume.basics.headline) ? "" : resume.basics.headline.trim();
}

function contactText(resume: PlatformResume) {
  const links = [isLinkLike(resume.basics.headline) ? resume.basics.headline : "", ...resume.basics.links.split("\n")];
  return [resume.basics.email, resume.basics.phone, resume.basics.location, ...links, ...resume.basics.additionalInfo.split("\n")]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("  |  ");
}

function dateRange(entry: ResumeEntry) {
  const currentLabel = containsCjk(JSON.stringify(entry)) ? "至今" : "Present";
  return [entry.startDate, entry.current ? currentLabel : entry.endDate].filter(Boolean).join(" - ");
}

function joinMeta(...values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join(" · ");
}

export function resumeEntryPresentation(entry: ResumeEntry): ResumeEntryPresentation {
  const date = entry.kind === "certifications" ? entry.date.trim() : dateRange(entry);
  let primary = "";
  let secondary = "";
  const descriptionLines: string[] = [];
  const inlineHighlights: string[] = [];
  for (const line of contentLines(entry.description)) {
    if (bulletPattern.test(line)) inlineHighlights.push(line.replace(bulletPattern, "").trim());
    else descriptionLines.push(line);
  }

  if (entry.kind === "experience" || (entry.kind === "experience_projects" && entry.category !== "project")) {
    primary = entry.position.trim() || entry.organization.trim();
    secondary = joinMeta(primary === entry.organization.trim() ? "" : entry.organization, entry.location);
  } else if ((entry.kind === "experience_projects" && entry.category === "project") || entry.kind === "projects") {
    primary = entry.projectName.trim() || entry.role.trim();
    secondary = joinMeta(primary === entry.role.trim() ? "" : entry.role, entry.url);
  } else if (entry.kind === "education") {
    primary = [entry.degree.trim(), entry.fieldOfStudy.trim()].filter(Boolean).join(", ") || entry.school.trim();
    secondary = joinMeta(primary === entry.school.trim() ? "" : entry.school, entry.location);
  } else if (entry.kind === "certifications") {
    primary = entry.name.trim() || entry.issuer.trim();
    secondary = joinMeta(primary === entry.issuer.trim() ? "" : entry.issuer, entry.url);
  } else if (entry.kind === "skills") {
    primary = entry.category.trim();
    secondary = entry.skills.map((skill) => skill.trim()).filter(Boolean).join(" · ");
  } else {
    primary = entry.title.trim();
    secondary = joinMeta(entry.subtitle, entry.location, entry.url);
  }

  return {
    primary,
    secondary,
    date,
    description: descriptionLines.join("\n").trim(),
    highlights: [...inlineHighlights, ...entry.highlights].map((item) => item.trim()).filter(Boolean),
  };
}

function hasEntryContent(entry: ResumeEntry) {
  const presentation = resumeEntryPresentation(entry);
  return Boolean(presentation.primary || presentation.secondary || presentation.date || presentation.description || presentation.highlights.length);
}

function displaySections(resume: PlatformResume) {
  return resume.sections.map((section): DisplaySection => ({
    type: section.type,
    title: section.title.trim() || "Section",
    content: section.content,
    entries: (section.entries ?? []).filter(hasEntryContent),
  })).filter((section) => section.title.trim() && (section.entries.length > 0 || section.content.trim()));
}

function classifyLines(content: string) {
  const classified: ContentLine[] = [];
  const lines = contentLines(content).map((line) => line.trim());
  let inEntryPreamble = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      classified.push({ kind: "blank", text: "" });
      inEntryPreamble = false;
      continue;
    }
    if (bulletPattern.test(line)) {
      let text = line.replace(bulletPattern, "");
      while (index + 1 < lines.length) {
        const continuation = lines[index + 1];
        if (!continuation || bulletPattern.test(continuation) || datePattern.test(continuation)) break;
        const following = lines.slice(index + 2).find(Boolean) ?? "";
        const looksLikeNextEntry = continuation.length <= 140 && /^[A-Z\u3400-\u9fff]/.test(continuation) && bulletPattern.test(following);
        if (looksLikeNextEntry) break;
        text = `${text} ${continuation}`;
        index += 1;
      }
      classified.push({ kind: "bullet", text });
      inEntryPreamble = false;
      continue;
    }
    const dated = line.match(datePattern);
    if (dated?.[1] && dated[2]) {
      classified.push({ kind: "entry", text: dated[1].trim(), date: dated[2].trim() });
      inEntryPreamble = true;
      continue;
    }
    if (inEntryPreamble) {
      classified.push({ kind: "meta", text: line });
      continue;
    }
    const next = lines.slice(index + 1).find(Boolean) ?? "";
    if (line.length <= 140 && bulletPattern.test(next)) classified.push({ kind: "entry", text: line });
    else classified.push({ kind: "body", text: line });
  }
  return classified;
}

function docxContent(content: string, tokens: TemplateTokens, usableWidth: number, template: ResumeTemplate) {
  const output: Paragraph[] = [];
  for (const line of classifyLines(content)) {
    if (line.kind === "blank") {
      output.push(new Paragraph({ spacing: { after: Math.round(tokens.bodySpacing * 0.45) } }));
      continue;
    }
    if (line.kind === "bullet") {
      output.push(new Paragraph({
        children: [new TextRun({ text: line.text, font: docxFonts(tokens.bodyFont), size: tokens.bodySize })],
        numbering: { reference: "resume-bullets", level: 0 },
        spacing: { after: Math.round(tokens.bodySpacing * 0.72), line: template === "compact" ? 238 : 248 },
      }));
      continue;
    }
    if (line.kind === "entry") {
      output.push(new Paragraph({
        children: [
          new TextRun({ text: line.text, bold: true, font: docxFonts(tokens.bodyFont), size: tokens.bodySize }),
          new TextRun({ text: "\t", font: docxFonts(tokens.bodyFont), size: tokens.bodySize }),
          new TextRun({ text: line.date ?? "", bold: true, color: "4E5752", font: docxFonts(tokens.bodyFont), size: Math.max(tokens.bodySize - 1, 16) }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: usableWidth }],
        spacing: { before: Math.round(tokens.bodySpacing * 0.45), after: 22, line: 240 },
        keepNext: true,
      }));
      continue;
    }
    if (line.kind === "meta") {
      output.push(new Paragraph({ children: [new TextRun({ text: line.text, italics: true, color: "59615D", font: docxFonts(tokens.bodyFont), size: Math.max(tokens.bodySize - 1, 16) })], spacing: { after: Math.round(tokens.bodySpacing * 0.7), line: 235 }, keepNext: true }));
      continue;
    }
    output.push(new Paragraph({ children: [new TextRun({ text: line.text, font: docxFonts(tokens.bodyFont), size: tokens.bodySize })], spacing: { after: tokens.bodySpacing, line: template === "compact" ? 238 : 248 } }));
  }
  return output;
}

function docxEntry(entry: ResumeEntry, index: number, tokens: TemplateTokens, usableWidth: number, template: ResumeTemplate) {
  const presentation = resumeEntryPresentation(entry);
  const output: Paragraph[] = [];
  const titleSize = tokens.bodySize + (template === "compact" ? 2 : 3);
  const entrySpacing = index === 0 ? 12 : template === "compact" ? 86 : 112;

  if (presentation.primary || presentation.date) {
    output.push(new Paragraph({
      children: [
        new TextRun({ text: presentation.primary, bold: true, font: docxFonts(tokens.bodyFont), size: titleSize, color: "1D2521" }),
        new TextRun({ text: "\t", font: docxFonts(tokens.bodyFont), size: titleSize }),
        new TextRun({ text: presentation.date, bold: true, color: "4E5752", font: docxFonts(tokens.bodyFont), size: Math.max(tokens.bodySize - 1, 16) }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: usableWidth }],
      spacing: { before: entrySpacing, after: 22, line: 240 },
      keepNext: Boolean(presentation.secondary || presentation.description || presentation.highlights.length),
    }));
  }
  if (presentation.secondary) {
    output.push(new Paragraph({
      children: [new TextRun({ text: presentation.secondary, color: "59635D", font: docxFonts(tokens.bodyFont), size: Math.max(tokens.bodySize - 1, 16) })],
      spacing: { after: presentation.description || presentation.highlights.length ? 38 : 16, line: 232 },
      keepNext: Boolean(presentation.description || presentation.highlights.length),
    }));
  }
  for (const paragraph of contentLines(presentation.description).map((line) => line.trim()).filter(Boolean)) {
    output.push(new Paragraph({
      children: [new TextRun({ text: paragraph, font: docxFonts(tokens.bodyFont), size: tokens.bodySize })],
      spacing: { after: Math.round(tokens.bodySpacing * 0.72), line: template === "compact" ? 238 : 248 },
    }));
  }
  for (const highlight of presentation.highlights) {
    output.push(new Paragraph({
      children: [new TextRun({ text: highlight, font: docxFonts(tokens.bodyFont), size: tokens.bodySize })],
      numbering: { reference: "resume-bullets", level: 0 },
      spacing: { after: Math.round(tokens.bodySpacing * 0.72), line: template === "compact" ? 238 : 248 },
    }));
  }
  return output;
}

export async function generateResumeDocx(resume: PlatformResume, template: ResumeTemplate) {
  resume = normalizePlatformResume(resume);
  const tokens = templateTokens[template];
  const pageWidth = 11906;
  const pageHeight = 16838;
  const usableWidth = pageWidth - tokens.margin * 2;
  const align = template === "classic" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const children: Paragraph[] = [new Paragraph({
    alignment: align,
    children: [new TextRun({ text: resume.basics.fullName || "Resume", bold: true, color: "1D2420", size: tokens.nameSize, font: docxFonts(tokens.bodyFont) })],
    spacing: { after: 45 },
    keepNext: true,
  })];
  const headline = effectiveHeadline(resume);
  if (headline) children.push(new Paragraph({ alignment: align, children: [new TextRun({ text: headline, color: tokens.accent, bold: true, size: tokens.headingSize, font: docxFonts(tokens.bodyFont) })], spacing: { after: 48 }, keepNext: true }));
  const contact = contactText(resume);
  if (contact) children.push(new Paragraph({ alignment: align, children: [new TextRun({ text: contact, color: "58615C", size: Math.max(tokens.bodySize - 2, 16), font: docxFonts(tokens.bodyFont) })], border: template === "modern" ? { bottom: { color: tokens.accent, size: 9, style: BorderStyle.SINGLE, space: 6 } } : undefined, spacing: { after: template === "compact" ? 95 : 130, line: 220 } }));

  const addSection = (title: string, content: string, entries: ResumeEntry[] = []) => {
    if (!content.trim() && entries.length === 0) return;
    children.push(new Paragraph({ children: [new TextRun({ text: title.trim().toUpperCase(), font: docxFonts(tokens.bodyFont) })], style: "ResumeSectionHeading" }));
    if (entries.length) entries.forEach((entry, index) => children.push(...docxEntry(entry, index, tokens, usableWidth, template)));
    else children.push(...docxContent(content, tokens, usableWidth, template));
  };
  if (resume.summary.trim()) addSection("Professional Summary", resume.summary);
  for (const section of displaySections(resume)) addSection(section.title, section.content, section.entries);

  const document = new Document({
    styles: {
      default: { document: { run: { font: docxFonts(tokens.bodyFont), size: tokens.bodySize, color: "262D29" }, paragraph: { spacing: { after: tokens.bodySpacing, line: 248 } } } },
      paragraphStyles: [{ id: "ResumeSectionHeading", name: "Resume Section Heading", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, color: tokens.accent, size: tokens.headingSize, font: docxFonts(tokens.bodyFont), characterSpacing: template === "modern" ? 12 : 0 }, paragraph: { keepNext: true, spacing: { before: template === "compact" ? 105 : 145, after: template === "compact" ? 48 : 62 }, border: template === "classic" ? { bottom: { color: "9AA39E", size: 5, style: BorderStyle.SINGLE, space: 3 } } : template === "compact" ? { bottom: { color: "C8CFCC", size: 3, style: BorderStyle.SINGLE, space: 2 } } : undefined } }],
    },
    numbering: { config: [{ reference: "resume-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 150 } } } }] }] },
    sections: [{ properties: { page: { size: { width: pageWidth, height: pageHeight }, margin: { top: tokens.margin, right: tokens.margin, bottom: tokens.margin, left: tokens.margin } } }, children }],
  });
  return Packer.toBuffer(document);
}

type PdfFontSource = { path: string; family?: string };

const bundledCjkFont: PdfFontSource = {
  path: join(process.cwd(), "assets/fonts/NotoSansCJKsc-Regular.otf"),
};

const sansCjkFontCandidates: PdfFontSource[] = [
  bundledCjkFont,
  { path: "/System/Library/Fonts/PingFang.ttc", family: "PingFangSC-Regular" },
  { path: "/System/Library/Fonts/Hiragino Sans GB.ttc", family: "HiraginoSansGB-W3" },
  { path: "/System/Library/Fonts/Hiragino Sans GB.ttc" },
  { path: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf" },
  { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
  { path: "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
  { path: "C:\\Windows\\Fonts\\msyh.ttc" },
  { path: "C:\\Windows\\Fonts\\arialuni.ttf" },
];

const serifCjkFontCandidates: PdfFontSource[] = [
  { path: "/System/Library/Fonts/Supplemental/Songti.ttc", family: "STSongti-SC-Regular" },
  ...sansCjkFontCandidates,
];

const sansCjkBoldFontCandidates: PdfFontSource[] = [
  { path: "/System/Library/Fonts/PingFang.ttc", family: "PingFangSC-Semibold" },
  { path: "/System/Library/Fonts/Hiragino Sans GB.ttc", family: "HiraginoSansGB-W6" },
  { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", family: "NotoSansCJKsc-Bold" },
  { path: "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", family: "NotoSansCJKsc-Bold" },
  bundledCjkFont,
  ...sansCjkFontCandidates,
];

const serifCjkBoldFontCandidates: PdfFontSource[] = [
  { path: "/System/Library/Fonts/Supplemental/Songti.ttc", family: "STSongti-SC-Bold" },
  ...sansCjkBoldFontCandidates,
];

function firstFont(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate));
}

function firstFontSource(candidates: PdfFontSource[]) {
  return candidates.find((candidate) => existsSync(candidate.path));
}

function pdfFonts(template: ResumeTemplate) {
  const serif = template === "classic";
  return {
    regular: firstFont(serif ? ["/System/Library/Fonts/Supplemental/Times New Roman.ttf"] : ["/System/Library/Fonts/Supplemental/Arial.ttf"]),
    bold: firstFont(serif ? ["/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"] : ["/System/Library/Fonts/Supplemental/Arial Bold.ttf"]),
    italic: firstFont(serif ? ["/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf"] : ["/System/Library/Fonts/Supplemental/Arial Italic.ttf"]),
    cjk: firstFontSource(serif ? serifCjkFontCandidates : sansCjkFontCandidates),
    cjkBold: firstFontSource(serif ? serifCjkBoldFontCandidates : sansCjkBoldFontCandidates),
  };
}

function pdfTokens(template: ResumeTemplate) {
  const source = templateTokens[template];
  return {
    accent: `#${source.accent}`,
    margin: source.margin / 20,
    bodySize: source.bodySize / 2,
    nameSize: source.nameSize / 2,
    headingSize: source.headingSize / 2,
    lineGap: template === "compact" ? 1.15 : 1.65,
  };
}

export async function generateResumePdf(resume: PlatformResume, template: ResumeTemplate) {
  resume = normalizePlatformResume(resume);
  const tokens = pdfTokens(template);
  const fonts = pdfFonts(template);
  if (!fonts.cjk) throw new Error("No CJK-compatible font is available for PDF export");
  const document = new PDFDocument({ size: "A4", margins: { top: tokens.margin, right: tokens.margin, bottom: tokens.margin, left: tokens.margin }, bufferPages: true, font: bundledCjkFont.path, info: { Title: resume.basics.fullName || "Resume", Creator: "JobPilot" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  document.registerFont("ResumeCjk", fonts.cjk.path, fonts.cjk.family);
  if (fonts.cjkBold) document.registerFont("ResumeCjkBold", fonts.cjkBold.path, fonts.cjkBold.family);
  if (fonts.regular) document.registerFont("ResumeRegular", fonts.regular);
  if (fonts.bold) document.registerFont("ResumeBold", fonts.bold);
  if (fonts.italic) document.registerFont("ResumeItalic", fonts.italic);

  const fontName = (text: string, style: "regular" | "bold" | "italic" = "regular") => containsCjk(text)
    ? style === "bold" && fonts.cjkBold ? "ResumeCjkBold" : "ResumeCjk"
    : style === "bold" && fonts.bold ? "ResumeBold"
      : style === "italic" && fonts.italic ? "ResumeItalic"
        : fonts.regular ? "ResumeRegular" : "ResumeCjk";
  const contentWidth = document.page.width - tokens.margin * 2;
  const bottom = () => document.page.height - tokens.margin;
  const ensureSpace = (height: number) => { if (document.y + height > bottom()) document.addPage(); };

  const sectionHeading = (title: string) => {
    ensureSpace(34);
    document.moveDown(template === "compact" ? 0.38 : 0.52);
    const y = document.y;
    if (template === "modern") document.save().fillColor(tokens.accent).rect(tokens.margin, y + 1, 3, tokens.headingSize + 2).fill().restore();
    document.font(fontName(title, "bold")).fillColor(tokens.accent).fontSize(tokens.headingSize).text(title.toUpperCase(), tokens.margin + (template === "modern" ? 9 : 0), y, { width: contentWidth - (template === "modern" ? 9 : 0), lineGap: 0 });
    if (template === "classic" || template === "compact") {
      const ruleY = document.y + 2;
      document.strokeColor(template === "classic" ? "#9AA39E" : "#C5CDCA").lineWidth(template === "classic" ? 0.65 : 0.4).moveTo(tokens.margin, ruleY).lineTo(document.page.width - tokens.margin, ruleY).stroke();
      document.y = ruleY + 5;
    } else document.moveDown(0.2);
  };

  const drawContent = (content: string) => {
    for (const line of classifyLines(content)) {
      if (line.kind === "blank") { document.moveDown(0.2); continue; }
      if (line.kind === "entry") {
        const dateWidth = Math.min(145, contentWidth * 0.32);
        const leftWidth = contentWidth - dateWidth - 10;
        document.font(fontName(line.text, "bold")).fontSize(tokens.bodySize).fillColor("#1F2723");
        const leftHeight = document.heightOfString(line.text, { width: leftWidth, lineGap: tokens.lineGap });
        document.font(fontName(line.date ?? "", "bold")).fontSize(Math.max(tokens.bodySize - 0.35, 8.2));
        const rightHeight = document.heightOfString(line.date ?? "", { width: dateWidth, lineGap: tokens.lineGap });
        ensureSpace(Math.max(leftHeight, rightHeight) + 7);
        const y = document.y;
        document.font(fontName(line.text, "bold")).fontSize(tokens.bodySize).fillColor("#1F2723").text(line.text, tokens.margin, y, { width: leftWidth, lineGap: tokens.lineGap });
        document.font(fontName(line.date ?? "", "bold")).fontSize(Math.max(tokens.bodySize - 0.35, 8.2)).fillColor("#4F5953").text(line.date ?? "", tokens.margin + leftWidth + 10, y, { width: dateWidth, align: "right", lineGap: tokens.lineGap });
        document.y = y + Math.max(leftHeight, rightHeight) + (template === "compact" ? 1.5 : 2.5);
        document.x = tokens.margin;
        continue;
      }
      if (line.kind === "meta") {
        const font = fontName(line.text, "italic");
        const size = Math.max(tokens.bodySize - 0.25, 8.4);
        document.font(font).fontSize(size);
        const height = document.heightOfString(line.text, { width: contentWidth, lineGap: tokens.lineGap });
        ensureSpace(height + 5);
        document.font(font).fontSize(size).fillColor("#59635D").text(line.text, tokens.margin, document.y, { width: contentWidth, lineGap: tokens.lineGap });
        document.moveDown(template === "compact" ? 0.12 : 0.2);
        continue;
      }
      if (line.kind === "bullet") {
        const indent = 12;
        document.font(fontName(line.text)).fontSize(tokens.bodySize);
        const height = document.heightOfString(line.text, { width: contentWidth - indent, lineGap: tokens.lineGap });
        ensureSpace(height + 5);
        const y = document.y;
        document.font("ResumeCjk").fillColor(tokens.accent).text("\u2022", tokens.margin, y, { width: 8, lineBreak: false });
        document.font(fontName(line.text)).fillColor("#28302C").text(line.text, tokens.margin + indent, y, { width: contentWidth - indent, lineGap: tokens.lineGap });
        document.moveDown(template === "compact" ? 0.1 : 0.16);
        continue;
      }
      const font = fontName(line.text);
      document.font(font).fontSize(tokens.bodySize);
      const height = document.heightOfString(line.text, { width: contentWidth, lineGap: tokens.lineGap });
      ensureSpace(height + 5);
      document.font(font).fontSize(tokens.bodySize).fillColor("#28302C").text(line.text, tokens.margin, document.y, { width: contentWidth, lineGap: tokens.lineGap });
      document.moveDown(template === "compact" ? 0.1 : 0.16);
    }
  };

  const drawParagraph = (text: string, options: { color?: string; indent?: number; size?: number; style?: "regular" | "bold" | "italic"; after?: number } = {}) => {
    const indent = options.indent ?? 0;
    const size = options.size ?? tokens.bodySize;
    const style = options.style ?? "regular";
    const width = contentWidth - indent;
    document.font(fontName(text, style)).fontSize(size);
    const height = document.heightOfString(text, { width, lineGap: tokens.lineGap });
    ensureSpace(height + (options.after ?? 3));
    const y = document.y;
    document.font(fontName(text, style)).fontSize(size).fillColor(options.color ?? "#28302C").text(text, tokens.margin + indent, y, { width, lineGap: tokens.lineGap });
    document.y = y + height + (options.after ?? 3);
    document.x = tokens.margin;
  };

  const drawEntry = (entry: ResumeEntry, index: number) => {
    const presentation = resumeEntryPresentation(entry);
    const titleSize = tokens.bodySize + (template === "compact" ? 0.8 : 1.15);
    const dateSize = Math.max(tokens.bodySize - 0.25, 8.2);
    const dateWidth = Math.min(150, contentWidth * 0.33);
    const leftWidth = presentation.date ? contentWidth - dateWidth - 12 : contentWidth;
    const topGap = index === 0 ? 1 : template === "compact" ? 6 : 8;
    document.y += topGap;

    if (presentation.primary || presentation.date) {
      document.font(fontName(presentation.primary, "bold")).fontSize(titleSize);
      const leftHeight = document.heightOfString(presentation.primary, { width: leftWidth, lineGap: tokens.lineGap });
      document.font(fontName(presentation.date, "bold")).fontSize(dateSize);
      const rightHeight = presentation.date ? document.heightOfString(presentation.date, { width: dateWidth, lineGap: tokens.lineGap }) : 0;
      ensureSpace(Math.max(leftHeight, rightHeight) + (presentation.secondary ? 18 : 8));
      const y = document.y;
      document.font(fontName(presentation.primary, "bold")).fontSize(titleSize).fillColor("#1D2521").text(presentation.primary, tokens.margin, y, { width: leftWidth, lineGap: tokens.lineGap });
      if (presentation.date) {
        document.font(fontName(presentation.date, "bold")).fontSize(dateSize).fillColor("#4E5752").text(presentation.date, tokens.margin + leftWidth + 12, y, { width: dateWidth, align: "right", lineGap: tokens.lineGap });
      }
      document.y = y + Math.max(leftHeight, rightHeight) + 2;
      document.x = tokens.margin;
    }
    if (presentation.secondary) drawParagraph(presentation.secondary, { color: "#59635D", size: Math.max(tokens.bodySize - 0.35, 8.3), after: presentation.description || presentation.highlights.length ? 4 : 1 });
    for (const paragraph of contentLines(presentation.description).map((line) => line.trim()).filter(Boolean)) {
      drawParagraph(paragraph, { after: template === "compact" ? 2.2 : 3.2 });
    }
    for (const highlight of presentation.highlights) {
      const indent = 13;
      document.font(fontName(highlight)).fontSize(tokens.bodySize);
      const height = document.heightOfString(highlight, { width: contentWidth - indent, lineGap: tokens.lineGap });
      ensureSpace(height + 4);
      const y = document.y;
      document.font("ResumeCjk").fontSize(tokens.bodySize).fillColor(tokens.accent).text("\u2022", tokens.margin, y, { width: 8, lineBreak: false });
      document.font(fontName(highlight)).fontSize(tokens.bodySize).fillColor("#28302C").text(highlight, tokens.margin + indent, y, { width: contentWidth - indent, lineGap: tokens.lineGap });
      document.y = y + height + (template === "compact" ? 2 : 3);
      document.x = tokens.margin;
    }
  };

  const headerAlign = template === "classic" ? "center" : "left";
  document.font(fontName(resume.basics.fullName || "Resume", "bold")).fillColor("#19201C").fontSize(tokens.nameSize).text(resume.basics.fullName || "Resume", { align: headerAlign, width: contentWidth, lineGap: 0 });
  const headline = effectiveHeadline(resume);
  if (headline) document.moveDown(0.08).font(fontName(headline, "bold")).fillColor(tokens.accent).fontSize(tokens.headingSize).text(headline, { align: headerAlign, width: contentWidth, lineGap: 0.5 });
  const contact = contactText(resume);
  if (contact) document.moveDown(0.2).font(fontName(contact)).fillColor("#56605A").fontSize(Math.max(tokens.bodySize - 0.8, 8.2)).text(contact, { align: headerAlign, width: contentWidth, lineGap: 1.2 });
  if (template === "modern") {
    const ruleY = document.y + 7;
    document.strokeColor(tokens.accent).lineWidth(1.35).moveTo(tokens.margin, ruleY).lineTo(document.page.width - tokens.margin, ruleY).stroke();
    document.y = ruleY + 2;
  }

  if (resume.summary.trim()) { sectionHeading("Professional Summary"); drawContent(resume.summary); }
  for (const section of displaySections(resume)) {
    sectionHeading(section.title);
    if (section.entries.length) section.entries.forEach(drawEntry);
    else drawContent(section.content);
  }

  document.end();
  return completed;
}

export function isResumeTemplate(value: string | null): value is ResumeTemplate {
  return resumeTemplates.includes(value as ResumeTemplate);
}
