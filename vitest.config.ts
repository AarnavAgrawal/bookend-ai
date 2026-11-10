import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    // The first test in each file boots and migrates Postgres, and files run in parallel.
    hookTimeout: 60_000,
  },
});
