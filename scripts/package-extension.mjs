import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";

const sourceDirectory = resolve("public/downloads/jobpilot-chrome-extension");
const outputPath = resolve("public/downloads/jobpilot-chrome-extension.zip");
const files = ["manifest.json", "popup.html", "popup.css", "popup.js"];
const archive = new JSZip();
const stableDate = new Date("2026-01-01T00:00:00.000Z");

for (const filename of files) {
  archive.file(filename, await readFile(resolve(sourceDirectory, filename)), {
    date: stableDate,
    unixPermissions: 0o644,
  });
}

const bytes = await archive.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX",
});
await writeFile(outputPath, bytes);
console.log("Packaged JobPilot Chrome extension.");
