import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

/** A real Postgres engine in memory, migrated with the same SQL production uses. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db: db as unknown as Db, close: () => client.close() };
}

export async function seedOrgWithJob(db: Db, name = "Test Plumbing") {
  const [org] = await db.insert(schema.orgs).values({ name }).returning();
  const [job] = await db
    .insert(schema.jobs)
    .values({ orgId: org.id, jobNumber: 1, title: "Replace water heater" })
    .returning();
  return { org, job };
}
