import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/resumes/[id]/export": ["./assets/fonts/**/*"],
    "/materials/[id]/export": ["./assets/fonts/**/*"],
    // pdf-parse loads pdfjs' legacy worker dynamically at runtime. Because
    // the parser is externalized, Next cannot infer this worker dependency.
    "/*": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    ],
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
