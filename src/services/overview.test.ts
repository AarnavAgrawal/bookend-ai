import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
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
import { orgOverview } from "./overview";
import { makeDeps, seedOrg, tokenOf } from "./testing";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

async function jobOnSite(ctx: ReturnType<typeof makeDeps>, orgId: string, title: string) {
  const job = await createJob(db, { orgId, title, customer: { name: "C" } });
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

describe("orgOverview", () => {
  it("counts open work and what needs the owner", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Org");
    await createJob(db, { orgId: org.id, title: "Draft job", customer: { name: "C" } });
    await jobOnSite(ctx, org.id, "Site job");

    const overview = await orgOverview(db, org.id);
    expect(overview).toMatchObject({ openJobs: 2, needsYou: 1, paidMarginBps: null });
    const site = overview.jobs.find((j) => j.title === "Site job");
    expect(site).toMatchObject({ state: "active", limitCents: 50_000, quotedMaterialsCents: 50_000 });
  });

  it("totals this month's card spend and leaves declines out", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Org");
    const job = await jobOnSite(ctx, org.id, "Site job");
    const buy = (amountCents: number) =>
      simulatePurchase(db, { orgId: org.id, jobId: job.id, merchantName: "M", amountCents });
    await buy(30_000);
    await buy(40_000); // over the $500 limit, so declined

    const overview = await orgOverview(db, org.id);
    expect(overview.spendThisMonthCents).toBe(30_000);
    expect(overview.jobs[0].spentCents).toBe(30_000);
  });

  it("reports margin across paid jobs, weighted by revenue", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Org");
    const job = await jobOnSite(ctx, org.id, "Site job");
    await simulatePurchase(db, { orgId: org.id, jobId: job.id, merchantName: "M", amountCents: 40_000 });
    const note = await addVoiceNote(ctx.deps, { orgId: org.id, jobId: job.id, typedNote: "Done", actor: "crew" });
    await closeJob(ctx.deps, {
      orgId: org.id,
      jobId: job.id,
      noteId: note.id,
      transcript: "Done",
      minutes: 0,
      actor: "crew",
    });
    await sendInvoice(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });
    await recordPayment(ctx.deps, { orgId: org.id, jobId: job.id, actor: "owner" });

    const overview = await orgOverview(db, org.id);
    // Billed $500 at no markup, spent $400: a $100 margin is 20%.
    expect(overview).toMatchObject({ paidRevenueCents: 50_000, paidMarginBps: 2_000, openJobs: 0 });
  });

  it("never shows another org's jobs or activity", async () => {
    const ctx = makeDeps(db);
    const a = await seedOrg(ctx.deps, "A");
    const b = await seedOrg(ctx.deps, "B");
    await jobOnSite(ctx, a.id, "A's job");

    const overview = await orgOverview(db, b.id);
    expect(overview.jobs).toEqual([]);
    expect(overview.activity).toEqual([]);
  });
});
