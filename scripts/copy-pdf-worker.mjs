import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const destination = resolve("public/pdf.worker.min.mjs");

await mkdir(resolve("public"), { recursive: true });
await copyFile(source, destination);
console.log("Prepared the PDF preview worker.");
