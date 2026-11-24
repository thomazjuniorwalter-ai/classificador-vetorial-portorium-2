import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/": ["./data/ecics/index.json.gz.*", "./data/ecics/metadata.json"],
    "/api/classificar": ["./data/ecics/index.json.gz.*", "./data/ecics/metadata.json"],
    "/api/lote/classificar": ["./data/ecics/index.json.gz.*", "./data/ecics/metadata.json"],
    "/api/ecics/status": ["./data/ecics/index.json.gz.*", "./data/ecics/metadata.json"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "125mb" }
  }
};

export default nextConfig;
