import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transitionJob } from "@/domain/jobs";
import { FakeRamp } from "@/ramp/fake";
import { approveCardOpen, executeOperation, requestCardOpen } from "@/ramp/guard";
import { applyTransaction } from "@/ramp/ledger";
import { limitDecline, makeTxn, seedAcceptedJob, seedActiveJob } from "@/ramp/testing";
import { createJob } from "@/services/jobs";
import type { Db } from "./client";
import * as schema from "./schema";
import { seedOrgWithJob } from "./testing";

/**
 * The in-memory test database has a single connection, so it can't prove that
 * row locks hold. This runs a real Postgres server with a real connection pool
 * and races 20 connections at once. Run it with `npm run test:pg`.
 */
const PARALLEL = 20;
const enabled = process.env.PG_TESTS === "1";
// Random, so a server left behind by an interrupted run can't block the next one.
const port = 54_000 + Math.floor(Math.random() * 1_000);

describe.skipIf(!enabled)("under real concurrency", () => {
  let server: EmbeddedPostgres;
  let pool: Pool;
  let db: Db;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "bookend-pg-"));
    server = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "test",
      port,
      persistent: false,
      onLog: () => {},
    });
    await server.initialise();
    await server.start();
    await server.createDatabase("bookend");
    pool = new Pool({
      connectionString: `postgres://postgres:test@localhost:${port}/bookend`,
      max: PARALLEL,
    });
    const database = drizzle(pool, { schema });
    await migrate(database, { migrationsFolder: "./drizzle" });
    db = database as unknown as Db;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  const race = <T>(work: () => Promise<T>) =>
    Promise.allSettled(Array.from({ length: PARALLEL }, work));
  const wins = <T>(results: PromiseSettledResult<T>[]) =>
    results.filter((r) => r.status === "fulfilled");

  it("really is running on separate connections", async () => {
    const results = await race(() => pool.query("select pg_backend_pid() as pid, pg_sleep(0.1)"));
    const pids = new Set(
      results.flatMap((r) => (r.status === "fulfilled" ? [r.value.rows[0].pid] : [])),
    );
    expect(pids.size).toBeGreaterThan(5);
  });

  it("applies a job event exactly once", async () => {
    const { org, job } = await seedOrgWithJob(db);
    const results = await race(() =>
      transitionJob(db, { orgId: org.id, jobId: job.id, event: "QUOTE_DRAFTED", actor: "x" }),
    );
    expect(wins(results)).toHaveLength(1);
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row).toMatchObject({ state: "quote_review", version: 1 });
    const audit = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, job.id));
    expect(audit).toHaveLength(1);
  });

  it("opens one card when an approval is confirmed 20 times at once", async () => {
    const ramp = new FakeRamp();
    const { org, job } = await seedAcceptedJob(db);
    const { token } = await requestCardOpen(db, { orgId: org.id, jobId: job.id, limitCents: 90_000 });

    const results = await race(() =>
      approveCardOpen(db, ramp, {
        orgId: org.id,
        token,
        approvedBy: "owner",
        expectedLimitCents: 90_000,
      }),
    );

    expect(wins(results)).toHaveLength(1);
    expect(ramp.funds.size).toBe(1);
    const funds = await db.select().from(schema.jobFunds).where(eq(schema.jobFunds.jobId, job.id));
    expect(funds).toHaveLength(1);
  });

  it("finishes an interrupted write once when many workers resume it", async () => {
    const ramp = new FakeRamp();
    const { org, job } = await seedAcceptedJob(db);
    const { token } = await requestCardOpen(db, { orgId: org.id, jobId: job.id, limitCents: 90_000 });
    ramp.failNext("createFund", new TypeError("fetch failed"), { afterEffect: true });
    await approveCardOpen(db, ramp, {
      orgId: org.id,
      token,
      approvedBy: "owner",
      expectedLimitCents: 90_000,
    });
    const [operation] = await db
      .select()
      .from(schema.rampOperations)
      .where(eq(schema.rampOperations.jobId, job.id));

    await race(() => executeOperation(db, ramp, operation.id));

    expect(ramp.funds.size).toBe(1);
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row.state).toBe("active");
    const events = await db
      .select()
      .from(schema.jobEvents)
      .where(eq(schema.jobEvents.jobId, job.id));
    expect(events.filter((e) => e.type === "CARD_VERIFIED")).toHaveLength(1);
  });

  it("records one ledger row when the same event lands 20 times", async () => {
    const ramp = new FakeRamp();
    const { job, fundId } = await seedActiveJob(db, ramp);
    const txn = makeTxn(fundId);
    const results = await race(() => applyTransaction(db, txn));
    expect(wins(results)).toHaveLength(PARALLEL);
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.jobId, job.id));
    expect(rows).toHaveLength(1);
  });

  it("opens one change order when 20 different declines land together", async () => {
    const ramp = new FakeRamp();
    const { job, fundId } = await seedActiveJob(db, ramp, { limitCents: 90_000 });
    let amount = 100_000;
    const results = await race(() => {
      amount += 1_000;
      return applyTransaction(db, limitDecline(fundId, amount));
    });

    expect(wins(results)).toHaveLength(PARALLEL);
    const orders = await db
      .select()
      .from(schema.changeOrders)
      .where(eq(schema.changeOrders.jobId, job.id));
    expect(orders).toHaveLength(1);
    expect(orders[0].declinedCents).toBe(120_000);
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row).toMatchObject({ state: "change_pending" });
  });

  it("loses no spend when 20 purchases land together", async () => {
    const ramp = new FakeRamp();
    const { job, fundId } = await seedActiveJob(db, ramp, { limitCents: 1_000_000 });
    const results = await race(() => applyTransaction(db, makeTxn(fundId, { amountCents: 100 })));
    expect(wins(results)).toHaveLength(PARALLEL);
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.jobId, job.id));
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(100 * PARALLEL);
  });

  it("hands out unique job numbers under load", async () => {
    const { org } = await seedOrgWithJob(db, "Busy Org");
    const results = await race(() =>
      createJob(db, { orgId: org.id, title: "Job", customer: { name: "C" } }),
    );
    expect(wins(results)).toHaveLength(PARALLEL);
    const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.orgId, org.id));
    expect(new Set(rows.map((r) => r.jobNumber)).size).toBe(PARALLEL + 1);
  });
});
