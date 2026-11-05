import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { changeOrders, jobFunds, jobs, transactions } from "@/db/schema";
import { transitionJob } from "@/domain/jobs";
import { computeLimitIncrease, summarizeSpend, type RampTxnState } from "@/domain/money";
import type { RampClient, RampTransaction } from "./client";

/**
 * Only these declines mean "the job needs more budget". A suspended card or a
 * fraud block must never turn into a change order for the customer.
 * Taken from Ramp's spec; the sandbox decline test confirms which one funds return.
 */
export const LIMIT_DECLINE_REASONS: ReadonlySet<string> = new Set([
  "AUTHORIZER_CARD_LIMIT",
  "AUTHORIZER_MEMBER_LIMIT",
  "AUTHORIZER_USER_LIMIT",
]);

const STATE_RANK: Record<RampTxnState, number> = {
  PENDING_INITIATION: 0,
  PENDING: 1,
  COMPLETION: 2,
  CLEARED: 3,
  DECLINED: 3,
  ERROR: 3,
};

export type ApplyResult = "applied" | "stale" | "unrouted";
export type TransactionSource = "ramp" | "simulated";

/**
 * Folds one Ramp transaction into the ledger. Webhooks and reconcile both end
 * here. Everything downstream is recomputed from stored rows rather than from
 * this one event, which is why duplicates and reordering can't change the result.
 */
export async function applyTransaction(
  db: Db,
  txn: RampTransaction,
  source: TransactionSource = "ramp",
): Promise<ApplyResult> {
  if (!txn.fundId) return "unrouted";
  const [route] = await db
    .select({ orgId: jobFunds.orgId, jobId: jobFunds.jobId })
    .from(jobFunds)
    .where(eq(jobFunds.rampFundId, txn.fundId));
  // Not one of ours. Shared sandboxes deliver every tenant's events to everyone.
  if (!route) return "unrouted";

  return db.transaction(async (tx) => {
    await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, route.jobId)).for("update");

    const [existing] = await tx
      .select({ state: transactions.state })
      .from(transactions)
      .where(eq(transactions.rampTransactionId, txn.id));
    // A slow fetch can return an older snapshot after a newer one was stored.
    const stale = existing && STATE_RANK[txn.state] < STATE_RANK[existing.state];

    if (!stale) {
      const values = {
        state: txn.state,
        amountCents: txn.amountCents,
        merchantName: txn.merchantName,
        declineReason: txn.declineReason,
        occurredAt: txn.occurredAt,
        source,
        updatedAt: new Date(),
      };
      await tx
        .insert(transactions)
        .values({ ...values, orgId: route.orgId, jobId: route.jobId, rampTransactionId: txn.id })
        .onConflictDoUpdate({ target: transactions.rampTransactionId, set: values });
    }

    await reevaluateJob(tx, route.orgId, route.jobId);
    return stale ? "stale" : "applied";
  });
}

/** Must run inside a transaction holding the job's row lock. */
async function reevaluateJob(tx: Db, orgId: string, jobId: string): Promise<void> {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  const [fund] = await tx.select().from(jobFunds).where(eq(jobFunds.jobId, jobId));
  const rows = await tx.select().from(transactions).where(eq(transactions.jobId, jobId));
  const spend = summarizeSpend(rows, fund.limitCents);

  const uncovered = rows.filter(
    (r) =>
      r.state === "DECLINED" &&
      r.amountCents > 0 &&
      r.declineReason !== null &&
      LIMIT_DECLINE_REASONS.has(r.declineReason) &&
      r.changeOrderId === null &&
      // A decline from before the last raise is a retry the raise already answered.
      (r.occurredAt === null || r.occurredAt > fund.limitChangedAt),
  );

  let [open] = await tx
    .select()
    .from(changeOrders)
    .where(and(eq(changeOrders.jobId, jobId), eq(changeOrders.ownerStatus, "pending")));

  if (!open && uncovered.length > 0 && job.state === "active") {
    [open] = await tx
      .insert(changeOrders)
      .values({ orgId, jobId, declinedCents: 0, requestedLimitCents: fund.limitCents })
      .returning();
    await transitionJob(tx, {
      orgId,
      jobId,
      event: "OVERRUN_DETECTED",
      actor: "system",
      data: { changeOrderId: open.id },
    });
  }

  if (open) {
    if (uncovered.length > 0) {
      await tx
        .update(transactions)
        .set({ changeOrderId: open.id })
        .where(
          inArray(
            transactions.id,
            uncovered.map((r) => r.id),
          ),
        );
    }
    // Retries are the same purchase, so the largest one sizes the change order.
    const covered = [...rows.filter((r) => r.changeOrderId === open.id), ...uncovered];
    const declinedCents = Math.max(...covered.map((r) => r.amountCents));
    const { newLimitCents } = computeLimitIncrease({
      currentLimitCents: fund.limitCents,
      committedCents: spend.committedCents,
      declinedCents,
    });
    await tx
      .update(changeOrders)
      .set({ declinedCents, requestedLimitCents: newLimitCents })
      .where(eq(changeOrders.id, open.id));
  }

  if (spend.nearLimit && job.nearLimitWarnedAt === null) {
    await tx.update(jobs).set({ nearLimitWarnedAt: new Date() }).where(eq(jobs.id, jobId));
  }
}

export type ReconcileResult = {
  funds: number;
  transactions: number;
  errors: Array<{ fundId: string; message: string }>;
};

/** The safety net for missed webhooks. One failing fund doesn't stop the rest. */
export async function reconcileFunds(db: Db, ramp: RampClient): Promise<ReconcileResult> {
  const funds = await db
    .select({ rampFundId: jobFunds.rampFundId })
    .from(jobFunds)
    .where(ne(jobFunds.state, "terminated"));

  const result: ReconcileResult = { funds: funds.length, transactions: 0, errors: [] };
  for (const { rampFundId } of funds) {
    try {
      for (const txn of await ramp.listFundTransactions(rampFundId)) {
        await applyTransaction(db, txn);
        result.transactions += 1;
      }
    } catch (error) {
      result.errors.push({
        fundId: rampFundId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
