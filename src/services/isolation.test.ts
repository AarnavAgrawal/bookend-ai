import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "@/db/testing";
import { priceProposal } from "@/ai/quote-agent";
import { enterReceiptByHand, explainChangeOrder, addReceipt, simulatePurchase } from "./field";
import {
  createJob,
  draftQuoteWithAgent,
  recordCustomerResponseByOwner,
  rejectChangeOrder,
  requestCard,
  requestRaise,
  saveQuote,
  sendQuoteToCustomer,
} from "./jobs";
import { backfillFromRamp, addPriceBookItem, searchPrices } from "./memory";
import { makeDeps, seedOrg } from "./testing";
import { priceObservations, changeOrders, jobFunds } from "@/db/schema";
import { eq } from "drizzle-orm";
import { makeTxn } from "@/ramp/testing";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

async function twoOrgs() {
  const ctx = makeDeps(db);
  const a = await seedOrg(ctx.deps, "Org A");
  const b = await seedOrg(ctx.deps, "Org B");
  const job = await createJob(db, { orgId: a.id, title: "A's job", customer: { name: "C" } });
  return { ctx, a, b, job };
}

describe("one org can't reach another org's data", () => {
  it("search only ever returns the caller's prices", async () => {
    const { a, b } = await twoOrgs();
    await addPriceBookItem(db, { orgId: a.id, item: "Copper pipe", unitCostCents: 999 });
    expect(await searchPrices(db, b.id, "copper")).toEqual([]);
    expect(await searchPrices(db, a.id, "copper")).toHaveLength(1);
  });

  it("another org's evidence id doesn't price a quote", async () => {
    const { a, b } = await twoOrgs();
    await addPriceBookItem(db, { orgId: a.id, item: "Copper pipe", unitCostCents: 999 });
    const [theirs] = await db.select().from(priceObservations);
    const [line] = await priceProposal(db, b.id, {
      assumptions: "",
      lines: [
        {
          kind: "material",
          description: "Pipe",
          quantity: 1,
          evidence_ids: [theirs.id],
          estimated_unit_cost_cents: 500,
        },
      ],
    });
    expect(line).toMatchObject({ unitCostCents: 500, evidenceIds: [], isEstimate: true });
  });

  it("every job action refuses another org's job", async () => {
    const { ctx, b, job } = await twoOrgs();
    const orgId = b.id;
    const jobId = job.id;
    const attempts: Array<[string, () => Promise<unknown>]> = [
      [
        "save quote",
        () =>
          saveQuote(db, {
            orgId,
            jobId,
            draftedBy: "owner",
            actor: "x",
            lines: [{ kind: "material", description: "P", quantity: 1, unitCostCents: 1 }],
          }),
      ],
      ["send quote", () => sendQuoteToCustomer(ctx.deps, { orgId, jobId, expectedVersion: 0, actor: "x" })],
      ["request card", () => requestCard(ctx.deps, { orgId, jobId })],
      ["request raise", () => requestRaise(ctx.deps, { orgId, jobId })],
      ["reject change", () => rejectChangeOrder(db, { orgId, jobId })],
      ["simulate", () => simulatePurchase(db, { orgId, jobId, merchantName: "M", amountCents: 1 })],
      ["explain", () => explainChangeOrder(ctx.deps, { orgId, jobId, note: "n", actor: "x" })],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toThrow();
    }
  });

  it("can't edit another org's receipt", async () => {
    const { ctx, a, b, job } = await twoOrgs();
    const { receipt } = await addReceipt(ctx.deps, {
      orgId: a.id,
      jobId: job.id,
      bytes: Buffer.from("x"),
      contentType: "image/jpeg",
      actor: "crew",
    });
    await expect(
      enterReceiptByHand(db, {
        orgId: b.id,
        jobId: job.id,
        receiptId: receipt.id,
        merchantName: "Hacked",
        totalCents: 1,
      }),
    ).rejects.toThrow();
  });

  it("can't answer another org's change order", async () => {
    const { a, b, job } = await twoOrgs();
    const [order] = await db
      .insert(changeOrders)
      .values({ orgId: a.id, jobId: job.id, declinedCents: 1, requestedLimitCents: 2 })
      .returning();
    await recordCustomerResponseByOwner(db, {
      orgId: b.id,
      changeOrderId: order.id,
      accepted: true,
    });
    expect((await db.select().from(changeOrders))[0].customerStatus).toBe("pending");
  });

  it("the agent's history for one org never reads another's", async () => {
    const { ctx, b, job } = await twoOrgs();
    await expect(
      draftQuoteWithAgent(
        { db, claude: { messages: {} } as never },
        { orgId: b.id, jobId: job.id, actor: "x" },
      ),
    ).rejects.toThrow("Job not found");
  });

  it("price memory backfills from the org's own funds only", async () => {
    const { ctx, a, b, job } = await twoOrgs();
    const fund = await ctx.ramp.createFund({
      idempotencyKey: "k",
      userId: "u",
      displayName: "A's fund",
      limitCents: 100,
    });
    await db.insert(jobFunds).values({
      orgId: a.id,
      jobId: job.id,
      rampFundId: fund.id,
      limitCents: 100,
      state: "active",
    });
    ctx.ramp.putTransaction(
      makeTxn(fund.id, { receiptItems: [{ description: "Valve", unitCostCents: 1_234 }] }),
    );
    // Spend elsewhere in the shared Ramp business belongs to someone else.
    ctx.ramp.putTransaction(
      makeTxn("not-this-orgs", { receiptItems: [{ description: "Secret", unitCostCents: 1 }] }),
    );

    expect(await backfillFromRamp(db, ctx.ramp, b.id)).toBe(0);
    expect(await backfillFromRamp(db, ctx.ramp, a.id)).toBe(1);
    expect(await db.select().from(priceObservations).where(eq(priceObservations.orgId, a.id))).toMatchObject([
      { item: "Valve", unitCostCents: 1_234, source: "ramp_merchant_data" },
    ]);
  });
});
