import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AiRefusedError } from "@/ai/claude";
import {
  draftChangeReason,
  EXTRACT_PROMPT_VERSION,
  extractReceipt,
  type ReceiptExtraction,
} from "@/ai/extract";
import type { Db } from "@/db/client";
import {
  changeOrders,
  jobFunds,
  jobs,
  laborEntries,
  manualCosts,
  rampConnections,
  receipts,
  transactions,
} from "@/db/schema";
import { summarizeSpend } from "@/domain/money";
import { verifyLink } from "@/platform/links";
import type { Deps } from "@/platform/deps";
import { applyTransaction } from "@/ramp/ledger";
import { assertAiBudget, NotAllowedError, recordAiUse } from "./jobs";
import { recordObservations } from "./memory";

const CREW_STATES = new Set(["active", "change_pending", "closing"]);

/** Up to a dollar apart still counts as the same purchase, for rounding and tips. */
const MATCH_TOLERANCE_CENTS = 100;

/** Resolves a crew link. The link stops working once the job is past the field stage. */
export async function jobFromCrewLink(deps: Pick<Deps, "db" | "secret">, token: string) {
  const jobId = verifyLink("crew", token, deps.secret);
  if (!jobId) return null;
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  return job && CREW_STATES.has(job.state) ? job : null;
}

export async function jobSpend(db: Db, jobId: string) {
  const [fund] = await db.select().from(jobFunds).where(eq(jobFunds.jobId, jobId));
  const rows = await db.select().from(transactions).where(eq(transactions.jobId, jobId));
  return {
    fund: fund ?? null,
    transactions: rows,
    spend: summarizeSpend(rows, fund?.limitCents ?? 0),
  };
}

function findMatch(
  rows: Array<typeof transactions.$inferSelect>,
  taken: Set<string>,
  totalCents: number,
) {
  return rows.find(
    (t) =>
      t.state !== "DECLINED" &&
      !taken.has(t.id) &&
      Math.abs(t.amountCents - totalCents) <= MATCH_TOLERANCE_CENTS,
  );
}

async function matchReceipt(
  db: Db,
  input: { receiptId: string; jobId: string; merchantName: string | null; totalCents: number },
) {
  const { receiptId, jobId, merchantName, totalCents } = input;
  const rows = await db.select().from(transactions).where(eq(transactions.jobId, jobId));
  const claimed = await db
    .select({ id: receipts.transactionId })
    .from(receipts)
    .where(eq(receipts.jobId, jobId));
  const taken = new Set(claimed.flatMap((r) => (r.id ? [r.id] : [])));
  const match = findMatch(rows, taken, totalCents);
  await db
    .update(receipts)
    .set({
      merchantName,
      totalCents,
      transactionId: match?.id ?? null,
      matchStatus: match ? "matched" : "needs_review",
    })
    .where(eq(receipts.id, receiptId));
}

async function rememberPrices(
  db: Db,
  input: { orgId: string; receiptId: string; extraction: ReceiptExtraction },
) {
  const { orgId, receiptId, extraction } = input;
  await recordObservations(
    db,
    extraction.items
      .filter((item) => item.unit_price_cents > 0)
      .map((item) => ({
        orgId,
        item: item.description,
        unitCostCents: item.unit_price_cents,
        source: "ramp_receipt" as const,
        sourceId: receiptId,
        observedAt: new Date(),
      })),
  );
}

/**
 * Saves the photo first, so it survives anything that fails after. If Claude
 * can't read it, the receipt waits for someone to type in the merchant and total.
 */
export async function addReceipt(
  deps: Pick<Deps, "db" | "claude" | "files">,
  input: { orgId: string; jobId: string; bytes: Buffer; contentType: string; actor: string },
) {
  const { db, claude, files } = deps;
  const { orgId, jobId, bytes, contentType, actor } = input;
  const blobKey = `${orgId}/${jobId}/receipts/${randomUUID()}`;
  await files.save(blobKey, bytes, contentType);
  const [receipt] = await db
    .insert(receipts)
    .values({ orgId, jobId, blobKey, contentType, matchStatus: "needs_review" })
    .returning();

  if (!claude) return { receipt, read: false as const };
  try {
    await assertAiBudget(db, orgId);
    const extraction = await extractReceipt(claude, bytes, contentType);
    await db.update(receipts).set({ extraction }).where(eq(receipts.id, receipt.id));
    await matchReceipt(db, {
      receiptId: receipt.id,
      jobId,
      merchantName: extraction.merchant,
      totalCents: extraction.total_cents,
    });
    await rememberPrices(db, { orgId, receiptId: receipt.id, extraction });
    await recordAiUse(db, {
      orgId,
      jobId,
      type: "RECEIPT_READ",
      promptVersion: EXTRACT_PROMPT_VERSION,
      actor,
    });
    return { receipt, read: true as const };
  } catch (error) {
    if (error instanceof AiRefusedError || error instanceof NotAllowedError) {
      return { receipt, read: false as const };
    }
    // The photo is safe. Reading it can be redone by hand.
    console.error("Receipt extraction failed", error);
    return { receipt, read: false as const };
  }
}

export async function enterReceiptByHand(
  db: Db,
  input: { orgId: string; jobId: string; receiptId: string; merchantName: string; totalCents: number },
) {
  const { orgId, jobId, receiptId, merchantName, totalCents } = input;
  const [receipt] = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.orgId, orgId), eq(receipts.jobId, jobId)));
  if (!receipt) throw new NotAllowedError("Receipt not found");
  await matchReceipt(db, { receiptId, jobId, merchantName, totalCents });
}

export async function addLabor(
  db: Db,
  input: { orgId: string; jobId: string; minutes: number; costRateCentsPerHour: number },
) {
  if (input.minutes <= 0) throw new NotAllowedError("Hours must be more than zero");
  await db.insert(laborEntries).values(input);
}

export async function addManualCost(
  db: Db,
  input: { orgId: string; jobId: string; description: string; amountCents: number },
) {
  if (input.amountCents <= 0) throw new NotAllowedError("Amount must be more than zero");
  await db.insert(manualCosts).values(input);
}

/**
 * Attaches the crew's explanation to the open change order. A decline has no
 * receipt, so this note and photo are all the owner and customer have to go on.
 */
export async function explainChangeOrder(
  deps: Pick<Deps, "db" | "claude" | "files">,
  input: {
    orgId: string;
    jobId: string;
    note: string;
    photo?: { bytes: Buffer; contentType: string };
    actor: string;
  },
) {
  const { db, claude, files } = deps;
  const { orgId, jobId, note, photo, actor } = input;
  const [order] = await db
    .select()
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.jobId, jobId),
        eq(changeOrders.orgId, orgId),
        eq(changeOrders.ownerStatus, "pending"),
      ),
    );
  if (!order) throw new NotAllowedError("No open change order");

  let evidenceBlobKey = order.evidenceBlobKey;
  if (photo) {
    evidenceBlobKey = `${orgId}/${jobId}/change-orders/${randomUUID()}`;
    await files.save(evidenceBlobKey, photo.bytes, photo.contentType);
  }

  let reason = note;
  if (claude) {
    try {
      await assertAiBudget(db, orgId);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      const [decline] = await db
        .select({ merchant: transactions.merchantName })
        .from(transactions)
        .where(eq(transactions.changeOrderId, order.id));
      reason = await draftChangeReason(claude, {
        jobTitle: job.title,
        merchant: decline?.merchant ?? null,
        declinedCents: order.declinedCents,
        crewNote: note,
      });
      await recordAiUse(db, {
        orgId,
        jobId,
        type: "CHANGE_ORDER_DRAFT",
        promptVersion: EXTRACT_PROMPT_VERSION,
        actor,
      });
    } catch (error) {
      // The crew's own words are a fine fallback for a customer-facing reason.
      console.error("Change order draft failed", error);
    }
  }
  await db
    .update(changeOrders)
    .set({ reason, evidenceBlobKey })
    .where(eq(changeOrders.id, order.id));
}

/**
 * Stands in for a card swipe where the sandbox can't produce one. It applies the
 * limit the way a card network would and feeds the same ledger as real events.
 * Rows are tagged `simulated`, and it refuses to run on a production connection.
 */
export async function simulatePurchase(
  db: Db,
  input: { orgId: string; jobId: string; merchantName: string; amountCents: number },
) {
  const { orgId, jobId, merchantName, amountCents } = input;
  if (amountCents <= 0) throw new NotAllowedError("Amount must be more than zero");
  const [connection] = await db
    .select({ mode: rampConnections.mode })
    .from(rampConnections)
    .where(eq(rampConnections.orgId, orgId));
  if (!connection || connection.mode === "production") {
    throw new NotAllowedError("Simulated purchases are for sandbox connections only");
  }
  const { fund, spend } = await jobSpend(db, jobId);
  if (!fund || fund.orgId !== orgId) throw new NotAllowedError("This job has no card");
  if (fund.state !== "active") throw new NotAllowedError("This card is frozen");

  const declined = spend.committedCents + amountCents > fund.limitCents;
  await applyTransaction(
    db,
    {
      id: `sim_${randomUUID()}`,
      fundId: fund.rampFundId,
      state: declined ? "DECLINED" : "CLEARED",
      amountCents,
      merchantName,
      declineReason: declined ? "AUTHORIZER_CARD_LIMIT" : null,
      occurredAt: new Date(),
      receiptItems: [],
    },
    "simulated",
  );
  return { declined };
}
