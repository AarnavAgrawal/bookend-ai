import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { invoices, jobFunds, jobs, priceObservations, quoteLines, quotes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { loadDemoBusiness } from "./demo";
import { orgOverview } from "./overview";
import { makeDeps, seedOrg } from "./testing";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

async function loaded() {
  const ctx = makeDeps(db);
  const org = await seedOrg(ctx.deps, "Demo Plumbing");
  await loadDemoBusiness(ctx.deps, org.id);
  return { ctx, org };
}

async function linesOf(title: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.title, title));
  const [quote] = await db.select().from(quotes).where(eq(quotes.jobId, job.id));
  return db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id));
}

describe("the demo business", () => {
  it("puts one job in each stage, all through the real services", async () => {
    const { ctx, org } = await loaded();

    const rows = await db.select().from(jobs).where(eq(jobs.orgId, org.id)).orderBy(asc(jobs.jobNumber));
    expect(rows.map((j) => j.state)).toEqual([
      "settled",
      "settled",
      "settled",
      "invoiced",
      "invoice_review",
      "change_pending",
      "active",
      "quote_sent",
      "quote_review",
      "draft",
    ]);

    // Only the open jobs' cards went to the Ramp the app talks to.
    const funds = await db.select().from(jobFunds).where(eq(jobFunds.orgId, org.id));
    expect(funds).toHaveLength(7);
    expect(funds.filter((f) => ctx.ramp.funds.has(f.rampFundId))).toHaveLength(4);
    expect(funds.filter((f) => f.state === "terminated")).toHaveLength(3);

    const paid = await db.select().from(invoices).where(eq(invoices.marginStatus, "final"));
    expect(paid).toHaveLength(3);
    for (const invoice of paid) expect(invoice.paidAt!.getTime()).toBeLessThan(Date.now() - 3 * 86_400_000);
  });

  it("prices the open jobs from the paid jobs and the price book", async () => {
    await loaded();
    const pastJobPrices = await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.source, "closed_job"));
    expect(pastJobPrices.length).toBeGreaterThan(0);

    // Price book 18.50, past jobs 19.00 and 18.00: the median is 18.50.
    const valve = (await linesOf("Replace copper supply lines under two sinks")).find(
      (l) => l.description === "Ball valve 3/4in",
    )!;
    expect(valve.evidenceIds).toHaveLength(3);
    expect(valve.unitCostCents).toBe(1_850);
    expect(valve.isEstimate).toBe(false);

    const toilet = (await linesOf("Replace two toilets")).find((l) => l.description.startsWith("Elongated"));
    expect(toilet?.isEstimate).toBe(true);
  });

  it("fills the overview", async () => {
    const { org } = await loaded();
    const overview = await orgOverview(db, org.id);
    expect(overview.paidMarginBps).not.toBeNull();
    expect(overview.paidJobs).toHaveLength(3);
    expect(overview.spendByDay.filter((d) => d.cents > 0).length).toBeGreaterThan(3);
  });

  it("only loads into an empty business", async () => {
    const { ctx, org } = await loaded();
    await expect(loadDemoBusiness(ctx.deps, org.id)).rejects.toThrow(/empty business/);
  });
});
