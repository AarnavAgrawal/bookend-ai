import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads a WASM build of Postgres from disk, so it can't be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
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
