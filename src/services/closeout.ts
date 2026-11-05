import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { EXTRACT_PROMPT_VERSION, extractVoiceNote, type VoiceExtraction } from "@/ai/extract";
import type { Db } from "@/db/client";
import {
  changeOrders,
  invoices,
  jobs,
  laborEntries,
  manualCosts,
  quoteLines,
  receipts,
  transactions,
  voiceNotes,
} from "@/db/schema";
import { transitionJob } from "@/domain/jobs";
import { applyBps, computeMargin, laborCost, summarizeSpend } from "@/domain/money";
import { lineSellCents } from "@/domain/quote";
import { renderInvoicePdf, type InvoiceLine } from "@/invoice/pdf";
import type { Deps } from "@/platform/deps";
import { signLink, verifyLink } from "@/platform/links";
import { suspendJobCard, terminateJobCard } from "@/ramp/guard";
import { applyTransaction } from "@/ramp/ledger";
import { jobSpend } from "./field";
import {
  assertAiBudget,
  customerOf,
  latestQuote,
  loadOrg,
  NotAllowedError,
  notify,
  recordAiUse,
} from "./jobs";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Stores the crew's end-of-job note. Nothing closes here: the transcript is shown
 * back to them first, because it's about to freeze the card and set the hours.
 */
export async function addVoiceNote(
  deps: Pick<Deps, "db" | "claude" | "transcriber" | "files">,
  input: {
    orgId: string;
    jobId: string;
    audio?: { bytes: Buffer; contentType: string };
    typedNote?: string;
    actor: string;
  },
) {
  const { db, claude, transcriber, files } = deps;
  const { orgId, jobId, audio, typedNote, actor } = input;

  let blobKey: string | null = null;
  if (audio) {
    blobKey = `${orgId}/${jobId}/voice/${randomUUID()}`;
    await files.save(blobKey, audio.bytes, audio.contentType);
  }
  let transcript = typedNote?.trim() || null;
  if (!transcript && audio && transcriber) {
    transcript = await transcriber.transcribe(audio.bytes, audio.contentType);
  }

  let extraction: VoiceExtraction | null = null;
  if (transcript && claude) {
    try {
      await assertAiBudget(db, orgId);
      extraction = await extractVoiceNote(claude, transcript);
      await recordAiUse(db, {
        orgId,
        jobId,
        type: "VOICE_NOTE_READ",
        promptVersion: EXTRACT_PROMPT_VERSION,
        actor,
      });
    } catch (error) {
      // The crew confirms the fields by hand anyway, so carry on without them.
      console.error("Voice note extraction failed", error);
    }
  }
  const [note] = await db
    .insert(voiceNotes)
    .values({ orgId, jobId, blobKey, transcript, extraction })
    .returning();
  return note;
}

async function revenueLines(db: Db, jobId: string): Promise<InvoiceLine[]> {
  const quote = await latestQuote(db, jobId);
  if (!quote) throw new NotAllowedError("There's no quote for this job");
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id));
  const orders = await db
    .select()
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.jobId, jobId),
        eq(changeOrders.ownerStatus, "approved"),
        eq(changeOrders.customerStatus, "accepted"),
      ),
    )
    .orderBy(asc(changeOrders.createdAt));
  return [
    ...lines.map((l) => ({ description: l.description, amountCents: lineSellCents(l) })),
    ...orders.map((o) => ({
      description: `Change order: ${o.reason ?? "additional materials"}`,
      amountCents: o.sellAmountCents ?? 0,
    })),
  ];
}

export async function jobMargin(db: Db, jobId: string, revenueCents: number) {
  const { transactions: rows, spend } = await jobSpend(db, jobId);
  const labor = await db.select().from(laborEntries).where(eq(laborEntries.jobId, jobId));
  const manual = await db.select().from(manualCosts).where(eq(manualCosts.jobId, jobId));
  const laborCents = labor.reduce(
    (sum, entry) => sum + laborCost(entry.minutes, entry.costRateCentsPerHour),
    0,
  );
  const manualCostsCents = manual.reduce((sum, entry) => sum + entry.amountCents, 0);
  return {
    materialsCents: spend.committedCents,
    laborCents,
    manualCostsCents,
    pendingCents: spend.pendingCents,
    transactionCount: rows.length,
    ...computeMargin({
      revenueCents,
      materialsCents: spend.committedCents,
      laborCents,
      manualCostsCents,
    }),
  };
}

async function draftInvoice(db: Db, orgId: string, jobId: string, taxRateBps: number) {
  const lines = await revenueLines(db, jobId);
  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const taxCents = applyBps(subtotalCents, taxRateBps);
  const margin = await jobMargin(db, jobId, subtotalCents);
  await db.transaction(async (tx) => {
    await tx.insert(invoices).values({
      orgId,
      jobId,
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      marginCents: margin.marginCents,
      marginBps: margin.marginBps,
    });
    await transitionJob(tx, { orgId, jobId, event: "INVOICE_DRAFTED", actor: "system" });
  });
}

/**
 * The crew confirmed the transcript. Their hours go on the job, the card is
 * frozen (reversibly, since clears can still land) and the invoice is drafted.
 */
export async function closeJob(
  deps: Pick<Deps, "db" | "ramp">,
  input: { orgId: string; jobId: string; noteId: string; transcript: string; minutes: number; actor: string },
) {
  const { db, ramp } = deps;
  const { orgId, jobId, noteId, transcript, minutes, actor } = input;
  const org = await loadOrg(db, orgId);

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(voiceNotes)
      .set({ transcript, confirmedAt: new Date() })
      .where(and(eq(voiceNotes.id, noteId), eq(voiceNotes.orgId, orgId), eq(voiceNotes.jobId, jobId)))
      .returning({ id: voiceNotes.id });
    if (updated.length === 0) throw new NotAllowedError("Note not found");
    if (minutes > 0) {
      await tx
        .insert(laborEntries)
        .values({ orgId, jobId, minutes, costRateCentsPerHour: org.laborCostCentsPerHour });
    }
    await transitionJob(tx, { orgId, jobId, event: "CREW_DONE", actor });
  });

  if (ramp) await suspendJobCard(db, ramp, jobId);
  await draftInvoice(db, orgId, jobId, org.taxRateBps);
}

async function loadInvoice(db: Db, orgId: string, jobId: string) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), eq(invoices.orgId, orgId)));
  if (!invoice) throw new NotAllowedError("No invoice for this job");
  return invoice;
}

/** Receipts can reveal markup, so attaching them is the org's choice. */
async function invoiceReceipts(deps: Pick<Deps, "db" | "files">, jobId: string) {
  const rows = await deps.db.select().from(receipts).where(eq(receipts.jobId, jobId));
  const files = await Promise.all(rows.map((r) => deps.files.load(r.blobKey)));
  return files.flatMap((file) =>
    file && ["image/jpeg", "image/png"].includes(file.contentType) ? [file] : [],
  );
}

export const invoiceUrl = (deps: Pick<Deps, "secret" | "appUrl">, invoiceId: string) =>
  `${deps.appUrl}/api/invoice/${signLink("invoice", invoiceId, deps.secret)}`;

export async function sendInvoice(
  deps: Pick<Deps, "db" | "files" | "mailer" | "secret" | "appUrl">,
  input: { orgId: string; jobId: string; actor: string },
) {
  const { db, files } = deps;
  const { orgId, jobId, actor } = input;
  const invoice = await loadInvoice(db, orgId, jobId);
  const org = await loadOrg(db, orgId);
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  const customer = await customerOf(db, job.customerId);

  const pdf = await renderInvoicePdf({
    businessName: org.name,
    invoiceNumber: `${job.jobNumber}`.padStart(4, "0"),
    issuedOn: new Date(),
    customerName: customer?.name ?? "Customer",
    customerAddress: customer?.address ?? null,
    jobTitle: job.title,
    lines: await revenueLines(db, jobId),
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    receipts: org.attachReceiptsToInvoice ? await invoiceReceipts(deps, jobId) : [],
  });
  const pdfBlobKey = `${orgId}/${jobId}/invoice-${invoice.id}.pdf`;
  await files.save(pdfBlobKey, pdf, "application/pdf");

  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({ pdfBlobKey, sentAt: new Date() })
      .where(eq(invoices.id, invoice.id));
    await transitionJob(tx, { orgId, jobId, event: "INVOICE_SENT", actor });
  });

  const url = invoiceUrl(deps, invoice.id);
  await notify(deps, {
    orgId,
    jobId,
    to: customer?.email ?? null,
    subject: `Invoice from ${org.name}: ${job.title}`,
    text: `Your invoice for ${job.title} is ${money(invoice.totalCents)}.\n\nView it here:\n${url}`,
    attachments: [{ filename: `invoice-${job.jobNumber}.pdf`, content: pdf }],
  });
  return { url };
}

export async function invoiceFromLink(deps: Pick<Deps, "db" | "files" | "secret">, token: string) {
  const id = verifyLink("invoice", token, deps.secret);
  if (!id) return null;
  const [invoice] = await deps.db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice?.pdfBlobKey) return null;
  return deps.files.load(invoice.pdfBlobKey);
}

/**
 * Takes one last read of Ramp, because clears and refunds can land after the
 * freeze. Only then is the margin final and the card closed for good.
 */
export async function recordPayment(
  deps: Pick<Deps, "db" | "ramp">,
  input: { orgId: string; jobId: string; actor: string },
) {
  const { db, ramp } = deps;
  const { orgId, jobId, actor } = input;
  const invoice = await loadInvoice(db, orgId, jobId);

  const { fund } = await jobSpend(db, jobId);
  if (ramp && fund) {
    for (const txn of await ramp.listFundTransactions(fund.rampFundId)) {
      await applyTransaction(db, txn);
    }
  }
  const margin = await jobMargin(db, jobId, invoice.subtotalCents);

  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({
        paidAt: new Date(),
        marginCents: margin.marginCents,
        marginBps: margin.marginBps,
        marginStatus: "final",
      })
      .where(eq(invoices.id, invoice.id));
    await transitionJob(tx, { orgId, jobId, event: "SETTLED", actor });
  });
  if (ramp) await terminateJobCard(db, ramp, jobId);
}

/** Margin only counts money that can't still change, so pending spend keeps it preliminary. */
export function marginIsSettled(rows: Array<typeof transactions.$inferSelect>) {
  return summarizeSpend(rows, 0).pendingCents === 0;
}
