export type ResumeExtractionErrorKind =
  | "password-protected"
  | "invalid-file"
  | "runtime-unavailable"
  | "unreadable";

export function classifyResumeExtractionError(error: unknown): ResumeExtractionErrorKind {
  const details = error instanceof Error
    ? `${error.name} ${error.message}`
    : String(error);
  const normalized = details.toLowerCase();

  if (normalized.includes("password")) return "password-protected";
  if (
    normalized.includes("invalidpdf") ||
    normalized.includes("invalid pdf") ||
    normalized.includes("invalid pdf structure") ||
    normalized.includes("missing pdf")
  ) {
    return "invalid-file";
  }
  if (
    normalized.includes("dommatrix") ||
    normalized.includes("@napi-rs/canvas") ||
    normalized.includes("failed to load external module") ||
    normalized.includes("cannot find module")
  ) {
    return "runtime-unavailable";
  }
  return "unreadable";
}

async function loadPdfParser() {
  // pdfjs expects these browser geometry primitives even when only extracting
  // text in Node. Importing the canvas package explicitly also makes Next.js
  // include its native Linux binary in serverless deployment traces.
  const canvas = await import("@napi-rs/canvas");
  const runtime = globalThis as unknown as Record<string, unknown>;
  runtime.DOMMatrix ??= canvas.DOMMatrix;
  runtime.ImageData ??= canvas.ImageData;
  runtime.Path2D ??= canvas.Path2D;
  return import("pdf-parse");
}

export async function extractResumeText(bytes: Buffer, extension: "pdf" | "docx" | "txt") {
  if (extension === "txt") return bytes.toString("utf8");
  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value;
  }
  const { PDFParse } = await loadPdfParser();
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    // A cleanup failure must not discard text that was extracted successfully.
    await parser.destroy().catch(() => undefined);
  }
}
