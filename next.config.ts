import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Private, always-fresh dashboard: every page is rendered dynamically per request.
  serverExternalPackages: ["exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
