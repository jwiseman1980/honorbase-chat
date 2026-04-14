import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow server-side fs writes in API routes
  serverExternalPackages: [],
  // Disable static export — we need server routes
  output: undefined,
};

export default nextConfig;
