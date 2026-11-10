import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, invoices, jobFunds, jobs, transactions } from "@/db/schema";
import { summarizeSpend } from "@/domain/money";
import type { JobState } from "@/domain/transition";

export type CardState = (typeof jobFunds.$inferSelect)["state"];

export type CardRow = {
  id: string;
  jobId: string;
  jobNumber: number;
  jobTitle: string;
  jobState: JobState;
  customer: string | null;
  state: CardState;
  limitCents: number;
  spentCents: number;
  remainingCents: number;
  openedAt: Date;
};

/** Every job card in one org with what it has spent, newest first. */
export async function listCards(db: Db, orgId: string): Promise<CardRow[]> {
  const rows = await db
    .select({ fund: jobFunds, job: jobs, customer: customers.name })
    .from(jobFunds)
    .innerJoin(jobs, eq(jobs.id, jobFunds.jobId))
    .leftJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(eq(jobFunds.orgId, orgId), eq(jobs.orgId, orgId)))
    .orderBy(desc(jobFunds.createdAt));
  const spend = await db
    .select({ jobId: transactions.jobId, state: transactions.state, amountCents: transactions.amountCents })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));

  return rows.map(({ fund, job, customer }) => {
    const summary = summarizeSpend(
      spend.filter((t) => t.jobId === job.id),
      fund.limitCents,
    );
    return {
      id: fund.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobTitle: job.title,
      jobState: job.state,
      customer,
      state: fund.state,
      limitCents: fund.limitCents,
      spentCents: summary.committedCents,
      remainingCents: summary.remainingCents,
      openedAt: fund.createdAt,
    };
  });
}

export type CustomerRow = {
  name: string;
  email: string | null;
  phone: string | null;
  jobCount: number;
  /** What paid invoices billed this customer before tax, as the overview counts revenue. */
  billedCents: number;
  lastJob: { id: string; title: string; at: Date } | null;
};

/**
 * Customers in one org. A customer record is created with each job, so records
 * that share a name are the same customer and are counted together.
 */
export async function listCustomers(db: Db, orgId: string): Promise<CustomerRow[]> {
  const rows = await db
    .select({ customer: customers, job: jobs })
    .from(customers)
    .leftJoin(jobs, and(eq(jobs.customerId, customers.id), eq(jobs.orgId, orgId)))
    .where(eq(customers.orgId, orgId))
    .orderBy(desc(customers.createdAt));
  const paid = await db
    .select({ jobId: invoices.jobId, subtotalCents: invoices.subtotalCents })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), isNotNull(invoices.paidAt)));
  const paidByJob = new Map<string, number>();
  for (const invoice of paid) paidByJob.set(invoice.jobId, (paidByJob.get(invoice.jobId) ?? 0) + invoice.subtotalCents);

  const byName = new Map<string, CustomerRow>();
  for (const { customer, job } of rows) {
    const key = customer.name.trim().toLowerCase();
    const row =
      byName.get(key) ??
      ({ name: customer.name.trim(), email: null, phone: null, jobCount: 0, billedCents: 0, lastJob: null } as CustomerRow);
    // Rows arrive newest first, so the first contact details seen are the latest.
    row.email ??= customer.email;
    row.phone ??= customer.phone;
    if (job) {
      row.jobCount += 1;
      row.billedCents += paidByJob.get(job.id) ?? 0;
      if (!row.lastJob || job.createdAt > row.lastJob.at) {
        row.lastJob = { id: job.id, title: job.title, at: job.createdAt };
      }
    }
    byName.set(key, row);
  }

  return [...byName.values()].sort(
    (a, b) => (b.lastJob?.at.getTime() ?? 0) - (a.lastJob?.at.getTime() ?? 0) || a.name.localeCompare(b.name),
  );
}
