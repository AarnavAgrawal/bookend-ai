import { and, desc, eq, gte } from "drizzle-orm";
import { STATUS_LABELS } from "@/components/app/primitives";
import { SOURCE_LABELS } from "@/components/evidence";
import type { Db } from "@/db/client";
import {
  changeOrders,
  customers,
  invoices,
  jobFunds,
  jobs,
  laborEntries,
  quoteLines,
  quotes,
  transactions,
} from "@/db/schema";
import { lineSellCents, medianCents } from "@/domain/quote";
import { searchPrices } from "./memory";
import { listJobRows, NEEDS_YOU, ON_SITE, WAITING } from "./overview";

/*
 * What "Ask Bookend" can look at. Every function is read-only, takes the org
 * from the signed-in session, and does its own arithmetic, so the model only
 * reads figures and never has to compute one.
 */

const dollars = (cents: number | null) => (cents === null ? null : Math.round(cents) / 100);
const day = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : null);
const pct = (bps: number | null) => (bps === null ? null : bps / 100);

export const JOB_FILTERS = ["all", "open", "needs_owner", "on_site", "waiting_on_customer", "paid", "cancelled"] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

export async function jobsSummary(db: Db, orgId: string, filter: JobFilter) {
  const rows = await listJobRows(db, orgId);
  const bills = await db.select().from(invoices).where(eq(invoices.orgId, orgId));
  const orders = await db.select().from(changeOrders).where(eq(changeOrders.orgId, orgId));
  const keep = (state: (typeof rows)[number]["state"]) => {
    switch (filter) {
      case "open":
        return state !== "settled" && state !== "cancelled";
      case "needs_owner":
        return NEEDS_YOU.includes(state);
      case "on_site":
        return ON_SITE.includes(state) || state === "change_pending";
      case "waiting_on_customer":
        return WAITING.includes(state);
      case "paid":
        return state === "settled";
      case "cancelled":
        return state === "cancelled";
      default:
        return true;
    }
  };
  return rows
    .filter((r) => keep(r.state))
    .map((r) => {
      const invoice = bills.find((i) => i.jobId === r.id);
      const overBy =
        r.quotedMaterialsCents !== null && r.spentCents > r.quotedMaterialsCents
          ? r.spentCents - r.quotedMaterialsCents
          : 0;
      return {
        job: `#${r.number}`,
        title: r.title,
        customer: r.customer,
        status: STATUS_LABELS[r.state],
        quote_total: dollars(r.totalCents),
        quoted_materials: dollars(r.quotedMaterialsCents),
        card_limit: dollars(r.limitCents),
        card_spent: dollars(r.spentCents),
        spent_over_quoted_materials: dollars(overBy),
        change_orders: orders.filter((o) => o.jobId === r.id).length,
        invoice_total: dollars(invoice?.totalCents ?? null),
        invoice_sent: day(invoice?.sentAt ?? null),
        paid_on: day(invoice?.paidAt ?? null),
        margin_percent: pct(invoice?.marginBps ?? null),
        margin_is_final: invoice ? invoice.marginStatus === "final" : null,
        last_activity: day(r.updatedAt),
      };
    });
}

export async function jobDetail(db: Db, orgId: string, jobNumber: number) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.jobNumber, jobNumber)));
  if (!job) return { error: `There is no job #${jobNumber}.` };

  const [customer] = job.customerId
    ? await db.select().from(customers).where(eq(customers.id, job.customerId))
    : [];
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.jobId, job.id))
    .orderBy(desc(quotes.version))
    .limit(1);
  const lines = quote ? await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id)) : [];
  const [fund] = await db.select().from(jobFunds).where(eq(jobFunds.jobId, job.id));
  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.jobId, job.id))
    .orderBy(desc(transactions.occurredAt));
  const orders = await db.select().from(changeOrders).where(eq(changeOrders.jobId, job.id));
  const [invoice] = await db.select().from(invoices).where(eq(invoices.jobId, job.id));
  const labor = await db.select().from(laborEntries).where(eq(laborEntries.jobId, job.id));

  return {
    job: `#${job.jobNumber}`,
    title: job.title,
    description: job.description,
    status: STATUS_LABELS[job.state],
    customer: customer?.name ?? null,
    created: day(job.createdAt),
    quote: quote
      ? {
          version: quote.version,
          drafted_by: quote.draftedBy === "agent" ? "Claude" : "owner",
          materials_cost: dollars(quote.materialsCostCents),
          subtotal: dollars(quote.subtotalSellCents),
          tax: dollars(quote.taxCents),
          total: dollars(quote.totalCents),
          accepted_on: day(quote.acceptedAt),
          lines: lines.map((l) => ({
            kind: l.kind,
            description: l.description,
            quantity: l.kind === "labor" ? `${l.quantity / 60} hours` : l.quantity,
            unit_cost: dollars(l.unitCostCents),
            line_price: dollars(lineSellCents(l)),
            priced_from_past_prices: l.evidenceIds.length,
            is_estimate: l.isEstimate,
          })),
        }
      : null,
    card: fund
      ? {
          limit: dollars(fund.limitCents),
          state: fund.state,
          purchases: txns.map((t) => ({
            merchant: t.merchantName,
            amount: dollars(t.amountCents),
            status: t.state === "DECLINED" ? "declined" : t.state.startsWith("PENDING") ? "pending" : "cleared",
            decline_reason: t.declineReason,
            date: day(t.occurredAt),
            simulated: t.source === "simulated",
          })),
        }
      : null,
    change_orders: orders.map((o) => ({
      declined_amount: dollars(o.declinedCents),
      reason: o.reason,
      new_limit: dollars(o.requestedLimitCents),
      billed_to_customer: dollars(o.sellAmountCents),
      owner: o.ownerStatus,
      customer: o.customerStatus,
    })),
    hours_worked: labor.reduce((sum, l) => sum + l.minutes, 0) / 60,
    invoice: invoice
      ? {
          subtotal: dollars(invoice.subtotalCents),
          tax: dollars(invoice.taxCents),
          total: dollars(invoice.totalCents),
          sent_on: day(invoice.sentAt),
          paid_on: day(invoice.paidAt),
          margin: dollars(invoice.marginCents),
          margin_percent: pct(invoice.marginBps),
          margin_is_final: invoice.marginStatus === "final",
        }
      : null,
  };
}

/** Every price this business has on record for an item, with the trend worked out. */
export async function priceHistory(db: Db, orgId: string, item: string) {
  const records = await searchPrices(db, orgId, item, 40);
  const byItem = new Map<string, typeof records>();
  for (const r of records) byItem.set(r.item, [...(byItem.get(r.item) ?? []), r]);
  return [...byItem].map(([name, rows]) => {
    const sorted = [...rows].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return {
      item: name,
      records: sorted.length,
      median: dollars(medianCents(sorted.map((r) => r.unitCostCents))),
      lowest: dollars(Math.min(...sorted.map((r) => r.unitCostCents))),
      highest: dollars(Math.max(...sorted.map((r) => r.unitCostCents))),
      latest: { price: dollars(last.unitCostCents), date: day(last.observedAt), source: SOURCE_LABELS[last.source] },
      change_since_first_percent:
        sorted.length > 1 && first.unitCostCents > 0
          ? Math.round(((last.unitCostCents - first.unitCostCents) * 1000) / first.unitCostCents) / 10
          : null,
      history: sorted.map((r) => ({ price: dollars(r.unitCostCents), date: day(r.observedAt), source: SOURCE_LABELS[r.source] })),
    };
  });
}

/** Card spend across every job card in a recent window. Declines are counted apart, since no money moved. */
export async function cardSpend(db: Db, orgId: string, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({ txn: transactions, job: jobs.jobNumber, title: jobs.title })
    .from(transactions)
    .innerJoin(jobs, eq(jobs.id, transactions.jobId))
    .where(and(eq(transactions.orgId, orgId), gte(transactions.occurredAt, since)));
  const spent = rows.filter((r) => r.txn.state !== "DECLINED" && r.txn.state !== "ERROR");
  const declined = rows.filter((r) => r.txn.state === "DECLINED");
  const total = (list: typeof rows) => list.reduce((sum, r) => sum + r.txn.amountCents, 0);
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const sums = new Map<string, number>();
    for (const r of spent) sums.set(key(r), (sums.get(key(r)) ?? 0) + r.txn.amountCents);
    return [...sums].sort((a, b) => b[1] - a[1]).map(([name, cents]) => ({ name, spent: dollars(cents) }));
  };
  return {
    from: day(since),
    to: day(now),
    total_spent: dollars(total(spent)),
    purchases: spent.length,
    declined_purchases: declined.length,
    declined_amount: dollars(total(declined)),
    by_job: group((r) => `#${r.job} ${r.title}`),
    by_merchant: group((r) => r.txn.merchantName ?? "Unknown merchant"),
  };
}
