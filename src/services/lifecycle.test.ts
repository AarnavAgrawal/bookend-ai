import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { changeOrders, invoices, jobFunds, jobs, outboxMessages, rampConnections, receipts } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { transitionJob } from "@/domain/jobs";
import { signLink } from "@/platform/links";
import { makeTxn } from "@/ramp/testing";
import { addVoiceNote, closeJob, invoiceFromLink, recordPayment, sendInvoice } from "./closeout";
import {
  addManualCost,
  addReceipt,
  enterReceiptByHand,
  explainChangeOrder,
  jobFromCrewLink,
  jobSpend,
  simulatePurchase,
} from "./field";
import {
  acceptQuoteFromLink,
  changeOrderUrl,
  confirmApproval,
  createJob,
  crewUrl,
  rejectChangeOrder,
  recordVerbalAcceptance,
  requestCard,
  requestRaise,
  respondToChangeOrder,
  saveQuote,
  sendQuoteToCustomer,
} from "./jobs";
import { makeDeps, seedOrg, tokenOf } from "./testing";

// A 1x1 PNG, enough for pdf-lib to embed as a receipt page.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

const stateOf = async (id: string) =>
  (await db.select().from(jobs).where(eq(jobs.id, id)))[0].state;

type Ctx = ReturnType<typeof makeDeps>;

async function quotedAndOpen(ctx: Ctx, orgId: string, jobId: string, version: number) {
  const { url } = await sendQuoteToCustomer(ctx.deps, {
    orgId,
    jobId,
    expectedVersion: version,
    actor: "owner",
  });
  await acceptQuoteFromLink(ctx.deps, tokenOf(url));
  const card = await requestCard(ctx.deps, { orgId, jobId });
  const status = await confirmApproval(ctx.deps, {
    token: tokenOf(card.url),
    approvedBy: "owner",
  });
  expect(status).toBe("succeeded");
  return card;
}

describe("a whole job, end to end", () => {
  it("runs a plumbing job through an overrun to a final margin", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Reliable Plumbing", {
      markupBps: 2_500,
      taxRateBps: 800,
      laborCostCentsPerHour: 4_000,
      laborBillCentsPerHour: 12_000,
    });
    const job = await createJob(db, {
      orgId: org.id,
      title: "Replace water heater",
      customer: { name: "Dana Reyes", email: "dana@example.test", address: "12 Elm St" },
    });
    expect(job.jobNumber).toBe(1);

    const quote = await saveQuote(db, {
      orgId: org.id,
      jobId: job.id,
      draftedBy: "owner",
      actor: "owner",
      lines: [
        { kind: "material", description: "50 gal heater", quantity: 1, unitCostCents: 72_000 },
        { kind: "material", description: "Fittings", quantity: 4, unitCostCents: 4_500 },
        { kind: "labor", description: "Install", quantity: 240, unitCostCents: 0 },
      ],
    });
    expect(quote).toMatchObject({
      materialsCostCents: 90_000,
      subtotalSellCents: 160_500,
      taxCents: 12_840,
      totalCents: 173_340,
    });

    const card = await quotedAndOpen(ctx, org.id, job.id, 1);
    // Materials plus sales tax, so an on-budget purchase isn't declined.
    expect(card.limitCents).toBe(97_200);
    expect(await stateOf(job.id)).toBe("active");

    const buy = (amountCents: number) =>
      simulatePurchase(db, { orgId: org.id, jobId: job.id, merchantName: "Ferguson", amountCents });

    expect(await buy(90_000)).toEqual({ declined: false });
    expect(await buy(20_000)).toEqual({ declined: true });
    expect(await stateOf(job.id)).toBe("change_pending");

    await explainChangeOrder(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      note: "Old flue is rotten, it needs replacing.",
      photo: { bytes: PNG, contentType: "image/png" },
      actor: "crew",
    });
    const raise = await requestRaise(ctx.deps, { orgId: org.id, jobId: job.id });
    expect(raise.newLimitCents).toBe(110_000);
    await confirmApproval(ctx.deps, { token: tokenOf(raise.url), approvedBy: "owner" });
    expect(await stateOf(job.id)).toBe("active");

    const [order] = await db.select().from(changeOrders);
    expect(order).toMatchObject({ sellAmountCents: 25_000, ownerStatus: "approved" });
    expect(order.evidenceBlobKey).not.toBeNull();

    expect(await buy(20_000)).toEqual({ declined: false });
    expect((await jobSpend(db, job.id)).spend.committedCents).toBe(110_000);

    // The customer agrees after the crew has moved on, which is the point.
    await respondToChangeOrder(ctx.deps, {
      token: tokenOf(changeOrderUrl(ctx.deps, order.id)),
      accepted: true,
    });

    const { receipt } = await addReceipt(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      bytes: PNG,
      contentType: "image/png",
      actor: "crew",
    });
    await enterReceiptByHand(db, {
      orgId: org.id,
      jobId: job.id,
      receiptId: receipt.id,
      merchantName: "Ferguson",
      totalCents: 90_000,
    });
    expect((await db.select().from(receipts))[0].matchStatus).toBe("matched");

    await addManualCost(db, {
      orgId: org.id,
      jobId: job.id,
      description: "Van stock",
      amountCents: 1_500,
    });

    const note = await addVoiceNote(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      typedNote: "All done, five hours.",
      actor: "crew",
    });
    await closeJob(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      noteId: note.id,
      transcript: "All done, five hours.",
      minutes: 300,
      actor: "crew",
    });
    expect(await stateOf(job.id)).toBe("invoice_review");
    const [fund] = await db.select().from(jobFunds);
    expect(ctx.ramp.funds.get(fund.rampFundId)?.state).toBe("SUSPENDED");

    const sent = await sendInvoice(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    const [invoice] = await db.select().from(invoices);
    expect(invoice).toMatchObject({
      subtotalCents: 185_500,
      taxCents: 14_840,
      totalCents: 200_340,
      marginStatus: "preliminary",
    });

    const pdf = await invoiceFromLink(ctx.deps, tokenOf(sent.url));
    const parsed = await PDFDocument.load(pdf?.bytes as Buffer);
    // The invoice page plus the receipt.
    expect(parsed.getPageCount()).toBe(2);

    await recordPayment(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    expect(await stateOf(job.id)).toBe("settled");
    expect((await db.select().from(invoices))[0]).toMatchObject({
      marginCents: 54_000,
      marginBps: 2_911,
      marginStatus: "final",
    });
    expect(ctx.ramp.funds.get(fund.rampFundId)?.state).toBe("TERMINATED");
  });

  it("runs a catering job with different numbers and no overrun", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Fig & Thyme Catering", {
      markupBps: 4_000,
      taxRateBps: 0,
      laborCostCentsPerHour: 2_000,
      laborBillCentsPerHour: 5_000,
      cardBufferCents: 5_000,
      attachReceiptsToInvoice: false,
    });
    const job = await createJob(db, {
      orgId: org.id,
      title: "Wedding lunch for 60",
      customer: { name: "Sam Okafor" },
    });
    await saveQuote(db, {
      orgId: org.id,
      jobId: job.id,
      draftedBy: "owner",
      actor: "owner",
      lines: [
        { kind: "material", description: "Lunch per head", quantity: 60, unitCostCents: 500 },
        { kind: "labor", description: "Service", quantity: 360, unitCostCents: 0 },
      ],
    });
    const card = await quotedAndOpen(ctx, org.id, job.id, 1);
    expect(card.limitCents).toBe(35_000);

    await simulatePurchase(db, {
      orgId: org.id,
      jobId: job.id,
      merchantName: "Restaurant Depot",
      amountCents: 28_000,
    });
    await addReceipt(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      bytes: PNG,
      contentType: "image/png",
      actor: "crew",
    });
    const note = await addVoiceNote(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      typedNote: "Done",
      actor: "crew",
    });
    await closeJob(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      noteId: note.id,
      transcript: "Done",
      minutes: 400,
      actor: "crew",
    });
    const sent = await sendInvoice(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    const pdf = await invoiceFromLink(ctx.deps, tokenOf(sent.url));
    // Receipts can reveal markup, and this org turned them off.
    expect((await PDFDocument.load(pdf?.bytes as Buffer)).getPageCount()).toBe(1);

    await recordPayment(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    expect((await db.select().from(invoices))[0]).toMatchObject({
      subtotalCents: 72_000,
      taxCents: 0,
      marginCents: 30_667,
      marginBps: 4_259,
      marginStatus: "final",
    });
  });
});

async function activeJob(ctx: Ctx, limitMaterials = 90_000) {
  const org = await seedOrg(ctx.deps, "Test Co");
  const job = await createJob(db, {
    orgId: org.id,
    title: "Test job",
    customer: { name: "A Customer", email: "c@example.test" },
  });
  await saveQuote(db, {
    orgId: org.id,
    jobId: job.id,
    draftedBy: "owner",
    actor: "owner",
    lines: [{ kind: "material", description: "Parts", quantity: 1, unitCostCents: limitMaterials }],
  });
  await quotedAndOpen(ctx, org.id, job.id, 1);
  return { org, job };
}

describe("billing a change order", () => {
  it("leaves out an overrun the customer turned down", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    await simulatePurchase(db, {
      orgId: org.id,
      jobId: job.id,
      merchantName: "Supplier",
      amountCents: 100_000,
    });
    const raise = await requestRaise(ctx.deps, { orgId: org.id, jobId: job.id });
    await confirmApproval(ctx.deps, { token: tokenOf(raise.url), approvedBy: "owner" });
    const [order] = await db.select().from(changeOrders);
    await respondToChangeOrder(ctx.deps, {
      token: tokenOf(changeOrderUrl(ctx.deps, order.id)),
      accepted: false,
    });

    const note = await addVoiceNote(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      typedNote: "Done",
      actor: "crew",
    });
    await closeJob(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      noteId: note.id,
      transcript: "Done",
      minutes: 0,
      actor: "crew",
    });
    expect((await db.select().from(invoices))[0].subtotalCents).toBe(90_000);
  });

  it("includes a change order the customer accepts after the invoice was drafted", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    await simulatePurchase(db, {
      orgId: org.id,
      jobId: job.id,
      merchantName: "Supplier",
      amountCents: 100_000,
    });
    const raise = await requestRaise(ctx.deps, { orgId: org.id, jobId: job.id });
    await confirmApproval(ctx.deps, { token: tokenOf(raise.url), approvedBy: "owner" });
    const note = await addVoiceNote(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      typedNote: "Done",
      actor: "crew",
    });
    await closeJob(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      noteId: note.id,
      transcript: "Done",
      minutes: 0,
      actor: "crew",
    });
    expect((await db.select().from(invoices))[0].subtotalCents).toBe(90_000);

    const [order] = await db.select().from(changeOrders);
    await respondToChangeOrder(ctx.deps, {
      token: tokenOf(changeOrderUrl(ctx.deps, order.id)),
      accepted: true,
    });
    await sendInvoice(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    expect((await db.select().from(invoices))[0].subtotalCents).toBe(190_000);
  });

  it("lets the owner refuse a raise, and the job carries on at the old limit", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    await simulatePurchase(db, {
      orgId: org.id,
      jobId: job.id,
      merchantName: "Supplier",
      amountCents: 100_000,
    });
    await rejectChangeOrder(db, { orgId: org.id, jobId: job.id });

    expect(await stateOf(job.id)).toBe("active");
    expect((await jobSpend(db, job.id)).fund?.limitCents).toBe(90_000);
    await expect(rejectChangeOrder(db, { orgId: org.id, jobId: job.id })).rejects.toThrow();
  });
});

describe("margin stays honest after the freeze", () => {
  it("counts a charge that clears after the card was suspended", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    const note = await addVoiceNote(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      typedNote: "Done",
      actor: "crew",
    });
    await closeJob(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      noteId: note.id,
      transcript: "Done",
      minutes: 0,
      actor: "crew",
    });
    await sendInvoice(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    expect((await db.select().from(invoices))[0].marginCents).toBe(90_000);

    const { fund } = await jobSpend(db, job.id);
    ctx.ramp.putTransaction(makeTxn(fund?.rampFundId as string, { amountCents: 30_000 }));

    await recordPayment(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    expect((await db.select().from(invoices))[0]).toMatchObject({
      marginCents: 60_000,
      marginStatus: "final",
    });
  });
});

describe("links stop working when the job moves on", () => {
  it("a crew link dies once the job is invoiced", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    const token = tokenOf(crewUrl(ctx.deps, job.id));
    expect((await jobFromCrewLink(ctx.deps, token))?.id).toBe(job.id);

    const note = await addVoiceNote(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      typedNote: "Done",
      actor: "crew",
    });
    await closeJob(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      noteId: note.id,
      transcript: "Done",
      minutes: 0,
      actor: "crew",
    });
    expect(await jobFromCrewLink(ctx.deps, token)).toBeNull();
  });

  it("a crew link for another job's id can't be forged", async () => {
    const ctx = makeDeps(db);
    const { job } = await activeJob(ctx);
    const forged = signLink("crew", job.id, "not-the-secret");
    expect(await jobFromCrewLink(ctx.deps, forged)).toBeNull();
  });

  it("a superseded quote link can't be accepted", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Test Co");
    const job = await createJob(db, { orgId: org.id, title: "Job", customer: { name: "C" } });
    const line = { kind: "material" as const, description: "Parts", quantity: 1, unitCostCents: 100 };
    const save = () =>
      saveQuote(db, {
        orgId: org.id,
        jobId: job.id,
        draftedBy: "owner",
        actor: "owner",
        lines: [line],
      });
    const first = await save();
    await save();
    await sendQuoteToCustomer(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      expectedVersion: 1,
      actor: "owner",
    });
    const stale = signLink("quote", first.id, ctx.deps.secret);
    await expect(acceptQuoteFromLink(ctx.deps, stale)).rejects.toThrow("no longer open");
    expect(await stateOf(job.id)).toBe("quote_sent");
  });

  it("a quote link accepts once", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Test Co");
    const job = await createJob(db, { orgId: org.id, title: "Job", customer: { name: "C" } });
    await saveQuote(db, {
      orgId: org.id,
      jobId: job.id,
      draftedBy: "owner",
      actor: "owner",
      lines: [{ kind: "material", description: "Parts", quantity: 1, unitCostCents: 100 }],
    });
    const { url } = await sendQuoteToCustomer(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      expectedVersion: 1,
      actor: "owner",
    });
    await acceptQuoteFromLink(ctx.deps, tokenOf(url));
    await expect(acceptQuoteFromLink(ctx.deps, tokenOf(url))).rejects.toThrow();
  });
});

describe("other guarantees", () => {
  it("records verbal acceptance from the owner", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Test Co");
    const job = await createJob(db, { orgId: org.id, title: "Job", customer: { name: "C" } });
    await saveQuote(db, {
      orgId: org.id,
      jobId: job.id,
      draftedBy: "owner",
      actor: "owner",
      lines: [{ kind: "material", description: "Parts", quantity: 1, unitCostCents: 100 }],
    });
    await sendQuoteToCustomer(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      expectedVersion: 1,
      actor: "owner",
    });
    await recordVerbalAcceptance(db, { orgId: org.id, jobId: job.id });
    expect(await stateOf(job.id)).toBe("accepted");
  });

  it("refuses to change a quote once it's been sent", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    await expect(
      saveQuote(db, {
        orgId: org.id,
        jobId: job.id,
        draftedBy: "owner",
        actor: "owner",
        lines: [{ kind: "material", description: "Parts", quantity: 1, unitCostCents: 1 }],
      }),
    ).rejects.toThrow("already been sent");
  });

  it("won't simulate spend on a production connection", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    await db.update(rampConnections).set({ mode: "production" });
    await expect(
      simulatePurchase(db, { orgId: org.id, jobId: job.id, merchantName: "X", amountCents: 100 }),
    ).rejects.toThrow("sandbox");
  });

  it("won't simulate spend on a frozen card", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    await db.update(jobFunds).set({ state: "suspended" });
    await expect(
      simulatePurchase(db, { orgId: org.id, jobId: job.id, merchantName: "X", amountCents: 100 }),
    ).rejects.toThrow("frozen");
  });

  it("keeps every message in the outbox, even with no address to send to", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Test Co");
    const job = await createJob(db, { orgId: org.id, title: "Job", customer: { name: "No Email" } });
    await saveQuote(db, {
      orgId: org.id,
      jobId: job.id,
      draftedBy: "owner",
      actor: "owner",
      lines: [{ kind: "material", description: "Parts", quantity: 1, unitCostCents: 100 }],
    });
    await sendQuoteToCustomer(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      expectedVersion: 1,
      actor: "owner",
    });
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(await db.select().from(outboxMessages)).toMatchObject([
      { toAddress: null, status: "logged" },
    ]);
  });

  it("gives each org its own job numbers, in order", async () => {
    const ctx = makeDeps(db);
    const a = await seedOrg(ctx.deps, "A");
    const b = await seedOrg(ctx.deps, "B");
    const make = (orgId: string) =>
      createJob(db, { orgId, title: "Job", customer: { name: "C" } });
    expect((await make(a.id)).jobNumber).toBe(1);
    expect((await make(a.id)).jobNumber).toBe(2);
    expect((await make(b.id)).jobNumber).toBe(1);
  });

  it("can cancel an active job", async () => {
    const ctx = makeDeps(db);
    const { org, job } = await activeJob(ctx);
    await transitionJob(db, { orgId: org.id, jobId: job.id, event: "CANCELLED", actor: "owner" });
    expect(await stateOf(job.id)).toBe("cancelled");
  });
});
