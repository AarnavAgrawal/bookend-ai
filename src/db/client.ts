import { Pool, neonConfig } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

/** Any Drizzle Postgres database, so tests can pass an in-memory one. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let db: Db | null = null;

/**
 * Lazy so `next build` doesn't need DATABASE_URL. The WebSocket driver is used
 * because the HTTP driver can't run the interactive transactions that row
 * locks in `transitionJob` depend on.
 */
export function getDb(): Db {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    neonConfig.webSocketConstructor = ws;
    db = drizzle(new Pool({ connectionString }), { schema });
  }
  return db;
}
