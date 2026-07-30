import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/resumes/[id]/export": ["./assets/fonts/**/*"],
    "/materials/[id]/export": ["./assets/fonts/**/*"],
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
