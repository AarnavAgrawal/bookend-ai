import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Only migrating needs this. Neon's unpooled URL is the direct connection
  // migrations want; the pooled one is the fallback.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
