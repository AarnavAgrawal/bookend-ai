import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Only `npm run db:migrate` needs this. Generating migrations does not.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
