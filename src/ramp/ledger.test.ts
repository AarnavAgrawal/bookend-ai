import { eq } from "drizzle-orm";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { changeOrders, jobs, transactions } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { transitionJob } from "@/domain/jobs";
import { RampApiError, type RampTransaction } from "./client";
import { FakeRamp } from "./fake";
import { applyTransaction, reconcileFunds } from "./ledger";
import { limitDecline, makeTxn, moveLimitChangedAt, seedActiveJob } from "./testing";

let db: Db;
let close: () => Promise<void>;
let ramp: FakeRamp;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ramp = new FakeRamp();
});
afterEach(() => close());

const jobRow = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
const ledgerRows = (jobId: string) =>
  db.select().from(transactions).where(eq(transactions.jobId, jobId));
const orders = (jobId: string) =>
  db.select().from(changeOrders).where(eq(changeOrders.jobId, jobId));

describe("applyTransaction", () => {
  it("records a purchase once, however often it arrives", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    const txn = makeTxn(fundId);
    await applyTransaction(db, txn);
    await applyTransaction(db, txn);
    expect(await ledgerRows(job.id)).toHaveLength(1);
  });

  it("ignores a transaction on a fund it doesn't know", async () => {
    await seedActiveJob(db, ramp);
    expect(await applyTransaction(db, makeTxn("someone-elses-fund"))).toBe("unrouted");
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it("routes by fund, so two orgs' spend never mix", async () => {
    const a = await seedActiveJob(db, ramp, { name: "Org A" });
    const b = await seedActiveJob(db, ramp, { name: "Org B" });
    await applyTransaction(db, makeTxn(a.fundId));
    expect(await ledgerRows(a.job.id)).toHaveLength(1);
    expect(await ledgerRows(b.job.id)).toHaveLength(0);
  });

  it("updates the amount when a pending charge clears for a different total", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    const pending = makeTxn(fundId, { state: "PENDING", amountCents: 10_000 });
    await applyTransaction(db, pending);
    await applyTransaction(db, { ...pending, state: "CLEARED", amountCents: 10_500 });
    expect(await ledgerRows(job.id)).toMatchObject([{ state: "CLEARED", amountCents: 10_500 }]);
  });

  it("won't let an old snapshot undo a cleared charge", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    const cleared = makeTxn(fundId, { amountCents: 10_500 });
    await applyTransaction(db, cleared);
    const result = await applyTransaction(db, { ...cleared, state: "PENDING", amountCents: 10_000 });
    expect(result).toBe("stale");
    expect(await ledgerRows(job.id)).toMatchObject([{ state: "CLEARED", amountCents: 10_500 }]);
  });
});

describe("overruns", () => {
  it("turns a limit decline into a change order sized by code", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp, { limitCents: 90_000 });
    await applyTransaction(db, makeTxn(fundId, { amountCents: 85_000 }));
    await applyTransaction(db, limitDecline(fundId, 25_000));

    expect((await jobRow(job.id)).state).toBe("change_pending");
    expect(await orders(job.id)).toMatchObject([
      { declinedCents: 25_000, requestedLimitCents: 110_000, ownerStatus: "pending" },
    ]);
  });

  it("doesn't open a change order for a decline that isn't about the limit", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    await applyTransaction(
      db,
      makeTxn(fundId, { state: "DECLINED", declineReason: "AUTHORIZER_SUSPENDED_CARD" }),
    );
    expect((await jobRow(job.id)).state).toBe("active");
    expect(await orders(job.id)).toHaveLength(0);
  });

  it("collapses retries into one change order, sized by the largest", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp, { limitCents: 90_000 });
    await applyTransaction(db, makeTxn(fundId, { amountCents: 85_000 }));
    await applyTransaction(db, limitDecline(fundId, 25_000));
    await applyTransaction(db, limitDecline(fundId, 30_000));
    await applyTransaction(db, limitDecline(fundId, 25_000));

    expect(await orders(job.id)).toMatchObject([
      { declinedCents: 30_000, requestedLimitCents: 115_000 },
    ]);
  });

  it("re-sizes the open change order when more spend lands", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp, { limitCents: 90_000 });
    await applyTransaction(db, limitDecline(fundId, 100_000));
    expect((await orders(job.id))[0].requestedLimitCents).toBe(100_000);

    await applyTransaction(db, makeTxn(fundId, { amountCents: 20_000 }));
    expect((await orders(job.id))[0].requestedLimitCents).toBe(120_000);
  });

  it("doesn't reopen a handled decline when the same event arrives again", async () => {
    const { job, org, fundId } = await seedActiveJob(db, ramp);
    const decline = limitDecline(fundId, 100_000);
    await applyTransaction(db, decline);
    await db.update(changeOrders).set({ ownerStatus: "approved" });
    await transitionJob(db, {
      orgId: org.id,
      jobId: job.id,
      event: "CHANGE_RESOLVED",
      actor: "test",
    });

    await applyTransaction(db, decline);
    expect((await jobRow(job.id)).state).toBe("active");
    expect(await orders(job.id)).toHaveLength(1);
  });

  it("ignores a late-arriving decline from before the last raise", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    await moveLimitChangedAt(db, job.id, new Date("2026-06-02T00:00:00Z"));
    await applyTransaction(db, limitDecline(fundId, 100_000));
    expect((await jobRow(job.id)).state).toBe("active");
    expect(await orders(job.id)).toHaveLength(0);
  });

  it("opens a new change order for a decline after the last raise", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    await moveLimitChangedAt(db, job.id, new Date("2026-05-01T00:00:00Z"));
    await applyTransaction(db, limitDecline(fundId, 100_000));
    expect((await jobRow(job.id)).state).toBe("change_pending");
  });

  it("records but doesn't act on a decline once the job is closing", async () => {
    const { job, org, fundId } = await seedActiveJob(db, ramp);
    await transitionJob(db, { orgId: org.id, jobId: job.id, event: "CREW_DONE", actor: "test" });
    await applyTransaction(db, limitDecline(fundId, 100_000));

    expect((await jobRow(job.id)).state).toBe("closing");
    expect(await orders(job.id)).toHaveLength(0);
    expect(await ledgerRows(job.id)).toHaveLength(1);
  });
});

describe("near-limit warning", () => {
  it("sets the flag at 85% and keeps the first timestamp", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp, { limitCents: 100_000 });
    await applyTransaction(db, makeTxn(fundId, { amountCents: 84_999 }));
    expect((await jobRow(job.id)).nearLimitWarnedAt).toBeNull();

    await applyTransaction(db, makeTxn(fundId, { amountCents: 1 }));
    const first = (await jobRow(job.id)).nearLimitWarnedAt;
    expect(first).not.toBeNull();

    await applyTransaction(db, makeTxn(fundId, { amountCents: 500 }));
    expect((await jobRow(job.id)).nearLimitWarnedAt).toEqual(first);
  });
});

describe("reconcileFunds", () => {
  it("recovers spend and declines whose webhooks never arrived", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp, { limitCents: 90_000 });
    ramp.putTransaction(makeTxn(fundId, { amountCents: 85_000 }));
    ramp.putTransaction(limitDecline(fundId, 25_000));

    const result = await reconcileFunds(db, ramp);

    expect(result).toEqual({ funds: 1, transactions: 2, errors: [] });
    expect((await jobRow(job.id)).state).toBe("change_pending");
    expect((await orders(job.id))[0].requestedLimitCents).toBe(110_000);
  });

  it("keeps going when one fund fails", async () => {
    const a = await seedActiveJob(db, ramp, { name: "Org A" });
    const b = await seedActiveJob(db, ramp, { name: "Org B" });
    ramp.putTransaction(makeTxn(a.fundId));
    ramp.putTransaction(makeTxn(b.fundId));
    ramp.failNext("listFundTransactions", new RampApiError(503, null, "down"));

    const result = await reconcileFunds(db, ramp);

    expect(result.errors).toHaveLength(1);
    expect(result.transactions).toBe(1);
  });
});

describe("the Phase 1 exit test", () => {
  /** Everything the product shows from the ledger, minus generated ids and clocks. */
  async function ledgerSnapshot(jobId: string, idPrefix: string) {
    const job = await jobRow(jobId);
    return {
      job: { state: job.state, version: job.version, warned: job.nearLimitWarnedAt !== null },
      transactions: (await ledgerRows(jobId))
        .map((r) => ({
          id: r.rampTransactionId.replace(idPrefix, ""),
          state: r.state,
          amountCents: r.amountCents,
          covered: r.changeOrderId !== null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      changeOrders: (await orders(jobId)).map((o) => ({
        declinedCents: o.declinedCents,
        requestedLimitCents: o.requestedLimitCents,
        ownerStatus: o.ownerStatus,
      })),
    };
  }

  type Purchase = {
    amountCents: number;
    kind: "cleared" | "pending" | "limit-decline" | "other-decline";
  };

  function toTransaction(p: Purchase, id: string, fundId: string): RampTransaction {
    if (p.kind === "limit-decline") return limitDecline(fundId, p.amountCents, id);
    if (p.kind === "other-decline") {
      return makeTxn(fundId, {
        id,
        amountCents: p.amountCents,
        state: "DECLINED",
        declineReason: "AUTHORIZER_SUSPENDED_CARD",
      });
    }
    const state = p.kind === "cleared" ? "CLEARED" : "PENDING";
    return makeTxn(fundId, { id, amountCents: p.amountCents, state });
  }

  const purchases = fc.array(
    fc.record({
      amountCents: fc.integer({ min: 1, max: 60_000 }),
      kind: fc.constantFrom("cleared", "pending", "limit-decline", "other-decline"),
    }),
    { minLength: 1, maxLength: 6 },
  ) as fc.Arbitrary<Purchase[]>;

  it("gives an identical ledger for duplicated, reordered and stale events", async () => {
    let overrunCases = 0;

    await fc.assert(
      fc.asyncProperty(
        purchases,
        fc.array(fc.nat(), { minLength: 18, maxLength: 18 }),
        fc.array(fc.nat({ max: 5 }), { maxLength: 6 }),
        async (bought, shuffleKeys, repeats) => {
          const clean = await seedActiveJob(db, ramp);
          const chaos = await seedActiveJob(db, ramp);

          for (const [i, p] of bought.entries()) {
            await applyTransaction(db, toTransaction(p, `clean-${clean.job.id}-${i}`, clean.fundId));
          }

          const finals = bought.map((p, i) =>
            toTransaction(p, `chaos-${chaos.job.id}-${i}`, chaos.fundId),
          );
          const staleSnapshots = finals
            .filter((t) => t.state === "CLEARED")
            .map((t): RampTransaction => ({ ...t, state: "PENDING" }));
          const duplicates = repeats.flatMap((i) => (finals[i] ? [finals[i]] : []));
          const delivered = [...finals, ...staleSnapshots, ...duplicates]
            .map((txn, i) => ({ txn, key: shuffleKeys[i] }))
            .sort((a, b) => a.key - b.key);
          for (const { txn } of delivered) await applyTransaction(db, txn);

          const expected = await ledgerSnapshot(clean.job.id, `clean-${clean.job.id}-`);
          const actual = await ledgerSnapshot(chaos.job.id, `chaos-${chaos.job.id}-`);
          expect(actual).toEqual(expected);
          if (expected.changeOrders.length > 0) overrunCases += 1;
        },
      ),
      { numRuns: 60 },
    );

    // Guards against the property passing only because nothing interesting happened.
    expect(overrunCases).toBeGreaterThan(5);
  }, 120_000);
});
