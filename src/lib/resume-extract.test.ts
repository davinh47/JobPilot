import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import { classifyResumeExtractionError, extractResumeText } from "@/lib/resume-extract";

function createTextPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument();
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.text(text);
    document.end();
  });
}

test("PDF extraction initializes the Node geometry runtime before loading pdfjs", async () => {
  const pdf = await createTextPdf("JobPilot PDF import regression check");
  const text = await extractResumeText(pdf, "pdf");

  assert.match(text, /JobPilot PDF import regression check/);
  assert.equal(typeof globalThis.DOMMatrix, "function");
  assert.equal(typeof globalThis.ImageData, "function");
  assert.equal(typeof globalThis.Path2D, "function");
});

test("PDF extraction errors distinguish deployment failures from file problems", () => {
  assert.equal(
    classifyResumeExtractionError(new Error("ReferenceError: DOMMatrix is not defined")),
    "runtime-unavailable",
  );
  assert.equal(
    classifyResumeExtractionError(new Error("PasswordException: No password given")),
    "password-protected",
  );
  assert.equal(
    classifyResumeExtractionError(new Error("InvalidPDFException: Invalid PDF structure.")),
    "invalid-file",
  );
});
