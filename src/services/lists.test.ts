import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { jobFunds } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { addVoiceNote, closeJob, recordPayment, sendInvoice } from "./closeout";
import { simulatePurchase } from "./field";
import {
  acceptQuoteFromLink,
  confirmApproval,
  createJob,
  requestCard,
  saveQuote,
  sendQuoteToCustomer,
} from "./jobs";
import { listCards, listCustomers } from "./lists";
import { makeDeps, seedOrg, tokenOf } from "./testing";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

type Customer = { name: string; email?: string; phone?: string };

async function jobOnSite(ctx: ReturnType<typeof makeDeps>, orgId: string, title: string, customer: Customer) {
  const job = await createJob(db, { orgId, title, customer });
  await saveQuote(db, {
    orgId,
    jobId: job.id,
    draftedBy: "owner",
    actor: "owner",
    lines: [{ kind: "material", description: "Parts", quantity: 1, unitCostCents: 50_000 }],
  });
  const { url } = await sendQuoteToCustomer(ctx.deps, {
    orgId,
    jobId: job.id,
    expectedVersion: 1,
    actor: "owner",
  });
  await acceptQuoteFromLink(ctx.deps, tokenOf(url));
  const card = await requestCard(ctx.deps, { orgId, jobId: job.id });
  await confirmApproval(ctx.deps, { token: tokenOf(card.url), approvedBy: "owner" });
  return job;
}

async function paidJob(ctx: ReturnType<typeof makeDeps>, orgId: string, title: string, customer: Customer) {
  const job = await jobOnSite(ctx, orgId, title, customer);
  const note = await addVoiceNote(ctx.deps, { orgId, jobId: job.id, typedNote: "Done", actor: "crew" });
  await closeJob(ctx.deps, { orgId, jobId: job.id, noteId: note.id, transcript: "Done", minutes: 0, actor: "crew" });
  await sendInvoice(ctx.deps, { orgId, jobId: job.id, actor: "owner" });
  await recordPayment(ctx.deps, { orgId, jobId: job.id, actor: "owner" });
  return job;
}

describe("listCards", () => {
  it("lists each job card with its limit, spend and what is left", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Org");
    const job = await jobOnSite(ctx, org.id, "Site job", { name: "Dana" });
    await simulatePurchase(db, { orgId: org.id, jobId: job.id, merchantName: "M", amountCents: 12_500 });

    const cards = await listCards(db, org.id);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      jobId: job.id,
      jobTitle: "Site job",
      customer: "Dana",
      state: "active",
      limitCents: 50_000,
      spentCents: 12_500,
      remainingCents: 37_500,
    });
  });

  it("leaves jobs without a card out and reports frozen cards", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Org");
    await createJob(db, { orgId: org.id, title: "Draft job", customer: { name: "C" } });
    const job = await jobOnSite(ctx, org.id, "Site job", { name: "C" });
    await db.update(jobFunds).set({ state: "suspended" }).where(eq(jobFunds.jobId, job.id));

    const cards = await listCards(db, org.id);
    expect(cards.map((c) => [c.jobTitle, c.state])).toEqual([["Site job", "suspended"]]);
  });

  it("never shows another org's cards", async () => {
    const ctx = makeDeps(db);
    const a = await seedOrg(ctx.deps, "A");
    const b = await seedOrg(ctx.deps, "B");
    await jobOnSite(ctx, a.id, "A's job", { name: "C" });

    expect(await listCards(db, b.id)).toEqual([]);
    expect(await listCards(db, a.id)).toHaveLength(1);
  });
});

describe("listCustomers", () => {
  it("counts a customer's jobs together and totals only paid invoices", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Org");
    await paidJob(ctx, org.id, "First job", { name: "Dana Lee", email: "old@example.test" });
    await jobOnSite(ctx, org.id, "Second job", { name: "dana lee ", phone: "555-0100" });
    await createJob(db, { orgId: org.id, title: "Other job", customer: { name: "Sam" } });

    const rows = await listCustomers(db, org.id);
    // One row per name, spelled the way it was last entered.
    expect(rows.map((r) => r.name).sort()).toEqual(["Sam", "dana lee"]);
    const dana = rows.find((r) => r.name === "dana lee");
    expect(dana).toMatchObject({ jobCount: 2, billedCents: 50_000, email: "old@example.test", phone: "555-0100" });
    expect(dana?.lastJob?.title).toBe("Second job");
    expect(rows.find((r) => r.name === "Sam")).toMatchObject({ jobCount: 1, billedCents: 0 });
  });

  it("never shows another org's customers", async () => {
    const ctx = makeDeps(db);
    const a = await seedOrg(ctx.deps, "A");
    const b = await seedOrg(ctx.deps, "B");
    await paidJob(ctx, a.id, "A's job", { name: "Dana" });
    await createJob(db, { orgId: b.id, title: "B's job", customer: { name: "Sam" } });

    const rows = await listCustomers(db, b.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Sam", jobCount: 1, billedCents: 0 });
  });
});
