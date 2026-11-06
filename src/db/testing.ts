import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

// Booting Postgres and migrating takes seconds, and each test file gets its own
// copy of this module, so that happens once per file rather than once per test.
let shared: Promise<{ client: PGlite; db: Db }> | null = null;

async function boot() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { client, db: db as unknown as Db };
}

/** A real Postgres engine in memory, migrated with the same SQL production uses. Starts empty. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  shared ??= boot();
  const { client, db } = await shared;
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await client.exec(`truncate ${tables} cascade`);
  return { db, close: async () => {} };
}

export async function seedOrgWithJob(db: Db, name = "Test Plumbing") {
  const [org] = await db.insert(schema.orgs).values({ name }).returning();
  const [job] = await db
    .insert(schema.jobs)
    .values({ orgId: org.id, jobNumber: 1, title: "Replace water heater" })
    .returning();
  return { org, job };
}
