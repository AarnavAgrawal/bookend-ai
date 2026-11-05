import { Pool, neonConfig } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

/** Any Drizzle Postgres database, so tests can pass an in-memory one. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// On globalThis so dev-server reloads don't open the local database twice.
const holder = globalThis as unknown as { bookendDb?: Promise<Db> };

/**
 * Lazy so `next build` doesn't need DATABASE_URL. The WebSocket driver is used
 * because the HTTP driver can't run the interactive transactions that row locks
 * in `transitionJob` depend on.
 */
export function getDb(): Promise<Db> {
  holder.bookendDb ??= openDb();
  return holder.bookendDb;
}

async function openDb(): Promise<Db> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    neonConfig.webSocketConstructor = ws;
    return drizzle(new Pool({ connectionString }), { schema });
  }
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is not set");
  const { openLocalDb } = await import("./local");
  return openLocalDb();
}
