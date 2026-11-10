import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, invoices, jobEvents, jobFunds, jobs, quotes, transactions } from "@/db/schema";
import { summarizeSpend } from "@/domain/money";
import type { JobState } from "@/domain/transition";

export const NEEDS_YOU: readonly JobState[] = [
  "change_pending",
  "quote_review",
  "accepted",
  "invoice_review",
  "draft",
  "card_opening",
];
export const ON_SITE: readonly JobState[] = ["active", "closing"];
export const WAITING: readonly JobState[] = ["quote_sent", "invoiced"];
export const FINISHED: readonly JobState[] = ["settled", "cancelled"];

export type JobRow = {
  id: string;
  number: number;
  title: string;
  customer: string | null;
  state: JobState;
  totalCents: number | null;
  quotedMaterialsCents: number | null;
  spentCents: number;
  limitCents: number | null;
  updatedAt: Date;
};

/** Every job in one org with the figures a list needs, newest activity first. */
export async function listJobRows(db: Db, orgId: string): Promise<JobRow[]> {
  const rows = await db
    .select({ job: jobs, customer: customers.name })
    .from(jobs)
    .leftJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.orgId, orgId))
    .orderBy(desc(jobs.updatedAt));
  const allQuotes = await db.select().from(quotes).where(eq(quotes.orgId, orgId));
  const funds = await db.select().from(jobFunds).where(eq(jobFunds.orgId, orgId));
  const spend = await db
    .select({ jobId: transactions.jobId, state: transactions.state, amountCents: transactions.amountCents })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));

  const latest = new Map<string, (typeof allQuotes)[number]>();
  for (const quote of allQuotes) {
    const current = latest.get(quote.jobId);
    if (!current || quote.version > current.version) latest.set(quote.jobId, quote);
  }
  const limits = new Map(funds.map((f) => [f.jobId, f.limitCents]));

  return rows.map(({ job, customer }) => {
    const quote = latest.get(job.id);
    const limitCents = limits.get(job.id) ?? null;
    const committed = summarizeSpend(
      spend.filter((t) => t.jobId === job.id),
      limitCents ?? 0,
    ).committedCents;
    return {
      id: job.id,
      number: job.jobNumber,
      title: job.title,
      customer,
      state: job.state,
      totalCents: quote?.totalCents ?? null,
      quotedMaterialsCents: quote?.materialsCostCents ?? null,
      spentCents: committed,
      limitCents,
      updatedAt: job.updatedAt,
    };
  });
}

export type Overview = {
  openJobs: number;
  needsYou: number;
  spendThisMonthCents: number;
  /** Margin across paid jobs, weighted by revenue. Null until a job is paid. */
  paidMarginBps: number | null;
  paidRevenueCents: number;
  jobs: JobRow[];
  /** Card spend per day for the last 30 days, oldest first, with dates as YYYY-MM-DD. */
  spendByDay: Array<{ date: string; cents: number }>;
  /** The most recent paid jobs, newest first. */
  paidJobs: Array<{ id: string; title: string; billedCents: number; marginCents: number; marginBps: number | null }>;
  activity: Array<{ id: string; jobId: string; jobTitle: string; toState: JobState | null; type: string; actor: string; at: Date }>;
};

export async function orgOverview(db: Db, orgId: string, now = new Date()): Promise<Overview> {
  const rows = await listJobRows(db, orgId);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const monthSpend = await db
    .select({ state: transactions.state, amountCents: transactions.amountCents, occurredAt: transactions.occurredAt })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));
  const spendThisMonthCents = summarizeSpend(
    monthSpend.filter((t) => t.occurredAt !== null && t.occurredAt >= monthStart),
    0,
  ).committedCents;

  const paid = await db
    .select({
      jobId: invoices.jobId,
      subtotalCents: invoices.subtotalCents,
      marginCents: invoices.marginCents,
      marginBps: invoices.marginBps,
      paidAt: invoices.paidAt,
    })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.marginStatus, "final")));
  const paidRevenueCents = paid.reduce((sum, i) => sum + i.subtotalCents, 0);
  const paidMarginCents = paid.reduce((sum, i) => sum + (i.marginCents ?? 0), 0);

  const titles = new Map(rows.map((r) => [r.id, r.title]));

  const DAY = 24 * 60 * 60 * 1000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i -= 1) byDay.set(new Date(today - i * DAY).toISOString().slice(0, 10), 0);
  for (const t of monthSpend) {
    if (!t.occurredAt || t.state === "DECLINED" || t.state === "ERROR") continue;
    const key = t.occurredAt.toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + t.amountCents);
  }
  const events = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.orgId, orgId))
    .orderBy(desc(jobEvents.createdAt))
    .limit(8);

  return {
    openJobs: rows.filter((r) => !FINISHED.includes(r.state)).length,
    needsYou: rows.filter((r) => NEEDS_YOU.includes(r.state)).length,
    spendThisMonthCents,
    paidMarginBps:
      paidRevenueCents === 0 ? null : Math.round((paidMarginCents * 10_000) / paidRevenueCents),
    paidRevenueCents,
    jobs: rows,
    spendByDay: [...byDay].map(([date, cents]) => ({ date, cents })),
    paidJobs: paid
      .filter((p) => p.paidAt !== null)
      .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))
      .slice(0, 6)
      .map((p) => ({
        id: p.jobId,
        title: titles.get(p.jobId) ?? "Job",
        billedCents: p.subtotalCents,
        marginCents: p.marginCents ?? 0,
        marginBps: p.marginBps,
      })),
    activity: events.map((e) => ({
      id: e.id,
      jobId: e.jobId,
      jobTitle: titles.get(e.jobId) ?? "Job",
      toState: e.toState,
      type: e.type,
      actor: e.actor,
      at: e.createdAt,
    })),
  };
}
