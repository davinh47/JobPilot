import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";

// Keep the downloadable archive in sync with the extension source users can
// load unpacked during local development.
const sourceDirectory = resolve("chrome-extension");
const outputPath = resolve("public/downloads/jobpilot-chrome-extension.zip");
const files = ["manifest.json", "popup.html", "popup.css", "popup.js"];
const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
const defaultJobPilotUrl = (() => {
  try {
    const url = new URL(configuredSiteUrl);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return "";
    return url.origin;
  } catch {
    return "";
  }
})();
const archive = new JSZip();
const stableDate = new Date("2026-01-01T00:00:00.000Z");

for (const filename of files) {
  let content = await readFile(resolve(sourceDirectory, filename), "utf8");
  if (filename === "popup.js") content = content.replaceAll("__JOBPILOT_DEFAULT_URL__", defaultJobPilotUrl);
  archive.file(filename, content, {
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
