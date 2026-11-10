"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AiRefusedError, AiUnavailableError } from "@/ai/claude";
import { members, orgs } from "@/db/schema";
import { JobNotFoundError, StaleJobError, transitionJob } from "@/domain/jobs";
import { IllegalTransitionError } from "@/domain/transition";
import { currentUserId, findSession, requireSession } from "@/platform/auth";
import { getDeps, type Deps } from "@/platform/deps";
import { ApprovalRejectedError, suspendJobCard, type ApprovalFailure } from "@/ramp/guard";
import { addVoiceNote, closeJob, recordPayment, runTick, sendInvoice } from "@/services/closeout";
import {
  addManualCost,
  enterReceiptByHand,
  jobFromCrewLink,
  simulatePurchase,
} from "@/services/field";
import {
  acceptQuoteFromLink,
  confirmApproval,
  connectRamp,
  createJob,
  draftQuoteWithAgent,
  NotAllowedError,
  recordCustomerResponseByOwner,
  recordVerbalAcceptance,
  rejectChangeOrder,
  requestCard,
  requestRaise,
  respondToChangeOrder,
  saveQuote,
  sendQuoteToCustomer,
} from "@/services/jobs";
import {
  addPriceBookItem,
  backfillFromRamp,
  importPriceCsv,
  loadSamplePrices,
} from "@/services/memory";

const APPROVAL_MESSAGES: Record<ApprovalFailure, string> = {
  invalid: "This approval link isn't valid.",
  consumed: "This approval has already been used.",
  expired: "This approval link has expired. Request a new one from the job page.",
  stale: "The job has changed since this link was made. Request a new one from the job page.",
  changed: "The amount has changed since this link was made. Request a new one from the job page.",
};

function friendly(error: unknown): string {
  if (error instanceof ApprovalRejectedError) return APPROVAL_MESSAGES[error.reason];
  if (error instanceof NotAllowedError) return error.message;
  if (error instanceof AiRefusedError) return "Claude couldn't do this one. Enter it by hand.";
  if (error instanceof AiUnavailableError) return "Claude isn't connected. Enter it by hand.";
  if (error instanceof StaleJobError) return "This job just changed. Check it and try again.";
  if (error instanceof IllegalTransitionError) return "That step doesn't apply to this job any more.";
  if (error instanceof JobNotFoundError) return "Job not found.";
  console.error(error);
  return "That didn't save. Try again, and check Settings if it keeps happening.";
}

/** Runs the work, then lands on `path`, carrying a readable error if it failed. */
async function attempt(
  path: string,
  work: () => Promise<string | void>,
  notice?: string,
): Promise<never> {
  let target = path;
  try {
    target = (await work()) ?? path;
    if (notice) target += `${target.includes("?") ? "&" : "?"}notice=${encodeURIComponent(notice)}`;
  } catch (error) {
    target = `${path}?error=${encodeURIComponent(friendly(error))}`;
  }
  revalidatePath(path);
  redirect(target);
}

const emailIsOff = () => !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM;

/** Says plainly when nothing was emailed, so the owner knows to share the link. */
const sentNotice = (thing: string, link: string) =>
  emailIsOff()
    ? `${thing} ready. Email isn't set up, so copy the ${link} and send it yourself.`
    : `${thing} sent`;

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const optional = (form: FormData, name: string) => text(form, name) || undefined;
const cents = (form: FormData, name: string) => Math.round(Number(text(form, name) || 0) * 100);
const bps = (form: FormData, name: string) => Math.round(Number(text(form, name) || 0) * 100);

async function owner() {
  const deps = await getDeps();
  return { deps, session: await requireSession(deps.db) };
}

const orgSettings = (form: FormData) => ({
  name: text(form, "name"),
  contactEmail: optional(form, "contactEmail") ?? null,
  laborCostCentsPerHour: cents(form, "laborCost"),
  laborBillCentsPerHour: cents(form, "laborBill"),
  markupBps: bps(form, "markup"),
  taxRateBps: bps(form, "tax"),
  cardBufferCents: cents(form, "buffer"),
});

export async function createOrgAction(form: FormData) {
  const deps = await getDeps();
  const userId = await currentUserId();
  await attempt("/onboarding", async () => {
    if (await findSession(deps.db, userId)) return "/dashboard";
    const settings = orgSettings(form);
    if (!settings.name) throw new NotAllowedError("Enter your business name.");
    const [org] = await deps.db.insert(orgs).values(settings).returning();
    await deps.db.insert(members).values({
      orgId: org.id,
      clerkUserId: userId,
      name: text(form, "ownerName") || "Owner",
      role: "owner",
    });
    if (deps.ramp) await connectRamp(deps, { orgId: org.id });
    return "/dashboard";
  });
}

export async function saveSettingsAction(form: FormData) {
  const { deps, session } = await owner();
  await attempt("/settings", async () => {
    await deps.db
      .update(orgs)
      .set({ ...orgSettings(form), attachReceiptsToInvoice: form.get("attachReceipts") === "on" })
      .where(eq(orgs.id, session.orgId));
  }, "Settings saved");
}

export async function connectRampAction() {
  const { deps, session } = await owner();
  await attempt("/settings", () => connectRamp(deps, { orgId: session.orgId }), "Ramp connected");
}

export async function createJobAction(form: FormData) {
  const { deps, session } = await owner();
  await attempt("/jobs/new", async () => {
    const title = text(form, "title");
    const name = text(form, "customerName");
    if (!title || !name) throw new NotAllowedError("A job needs a title and a customer name.");
    const job = await createJob(deps.db, {
      orgId: session.orgId,
      title,
      description: optional(form, "description"),
      customer: {
        name,
        email: optional(form, "customerEmail"),
        phone: optional(form, "customerPhone"),
        address: optional(form, "customerAddress"),
      },
    });
    return `/jobs/${job.id}`;
  }, "Job created");
}

export async function draftWithClaudeAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    await draftQuoteWithAgent(deps, { orgId: session.orgId, jobId, actor: session.name });
  }, "Quote drafted from your price history");
}

const linesSchema = z.array(
  z.object({
    kind: z.enum(["material", "labor", "other"]),
    description: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    unitCostCents: z.number().int().nonnegative(),
    evidenceIds: z.array(z.string()),
    isEstimate: z.boolean(),
  }),
);

export async function saveQuoteAction(jobId: string, form: FormData) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    const lines = linesSchema.safeParse(JSON.parse(text(form, "lines") || "[]"));
    if (!lines.success) throw new NotAllowedError("Every line needs a description and a quantity.");
    await saveQuote(deps.db, {
      orgId: session.orgId,
      jobId,
      lines: lines.data,
      assumptions: optional(form, "assumptions"),
      draftedBy: "owner",
      actor: session.name,
    });
  }, "Quote saved");
}

export async function sendQuoteAction(jobId: string, version: number) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    await sendQuoteToCustomer(deps, {
      orgId: session.orgId,
      jobId,
      expectedVersion: version,
      actor: session.name,
    });
  }, sentNotice("Quote", "customer link"));
}

export async function recordAcceptanceAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, () =>
    recordVerbalAcceptance(deps.db, { orgId: session.orgId, jobId }),
    "Acceptance recorded",
  );
}

const pathOf = (url: string) => new URL(url).pathname;

export async function requestCardAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    const { url } = await requestCard(deps, { orgId: session.orgId, jobId });
    return pathOf(url);
  });
}

export async function requestRaiseAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    const { url } = await requestRaise(deps, { orgId: session.orgId, jobId });
    return pathOf(url);
  });
}

export async function rejectChangeAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, () => rejectChangeOrder(deps.db, { orgId: session.orgId, jobId }), "Limit kept. The crew carries on within it.");
}

export async function ownerCustomerResponseAction(
  jobId: string,
  changeOrderId: string,
  accepted: boolean,
) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, () =>
    recordCustomerResponseByOwner(deps.db, { orgId: session.orgId, changeOrderId, accepted }),
    "Customer response recorded",
  );
}

export async function sendInvoiceAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    await sendInvoice(deps, { orgId: session.orgId, jobId, actor: session.name });
  }, sentNotice("Invoice", "invoice link"));
}

export async function recordPaymentAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, () =>
    recordPayment(deps, { orgId: session.orgId, jobId, actor: session.name }),
    "Marked as paid. The job card is closed.",
  );
}

export async function cancelJobAction(jobId: string) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    await transitionJob(deps.db, {
      orgId: session.orgId,
      jobId,
      event: "CANCELLED",
      actor: session.name,
    });
    if (deps.ramp) await suspendJobCard(deps.db, deps.ramp, jobId);
  }, "Job cancelled");
}

export async function syncAction(jobId: string) {
  const { deps } = await owner();
  await attempt(`/jobs/${jobId}`, async () => {
    await runTick(deps);
  }, "Checked Ramp for new card activity");
}

export async function enterReceiptAction(jobId: string, receiptId: string, form: FormData) {
  const { deps, session } = await owner();
  await attempt(`/jobs/${jobId}`, () =>
    enterReceiptByHand(deps.db, {
      orgId: session.orgId,
      jobId,
      receiptId,
      merchantName: text(form, "merchant"),
      totalCents: cents(form, "total"),
    }),
    "Receipt saved",
  );
}

export async function addPriceAction(form: FormData) {
  const { deps, session } = await owner();
  await attempt("/prices", async () => {
    const item = text(form, "item");
    const unitCostCents = cents(form, "cost");
    if (!item || unitCostCents <= 0) throw new NotAllowedError("Enter an item and a cost.");
    await addPriceBookItem(deps.db, { orgId: session.orgId, item, unitCostCents });
  }, "Price added");
}

export async function importPricesAction(form: FormData) {
  const { deps, session } = await owner();
  await attempt("/prices", async () => {
    const csv = text(form, "csv");
    const count = await importPriceCsv(deps.db, { orgId: session.orgId, csv });
    if (count === 0) throw new NotAllowedError("No rows found. Use one `item,cost` per line.");
  }, "Prices imported");
}

export async function loadSamplePricesAction() {
  const { deps, session } = await owner();
  await attempt("/prices", async () => {
    await loadSamplePrices(deps.db, session.orgId);
  }, "Sample prices added");
}

export async function backfillAction() {
  const { deps, session } = await owner();
  await attempt("/prices", async () => {
    if (!deps.ramp) throw new NotAllowedError("Ramp isn't connected.");
    await backfillFromRamp(deps.db, deps.ramp, session.orgId);
  }, "Pulled item prices from Ramp");
}

// Public actions. Each one is authorized by the signed token it's given.

export async function confirmApprovalAction(token: string) {
  const deps = await getDeps();
  await attempt(`/approve/${token}`, async () => {
    const status = await confirmApproval(deps, { token, approvedBy: "owner (approval link)" });
    if (status === "failed") throw new NotAllowedError("Ramp rejected this. Check the job page.");
    return `/approve/${token}?done=${status}`;
  });
}

export async function acceptQuoteAction(token: string) {
  const deps = await getDeps();
  await attempt(`/q/${token}`, async () => {
    await acceptQuoteFromLink(deps, token);
    return `/q/${token}?done=1`;
  });
}

export async function respondChangeOrderAction(token: string, accepted: boolean) {
  const deps = await getDeps();
  await attempt(`/c/${token}`, () => respondToChangeOrder(deps, { token, accepted }));
}

async function crew(deps: Deps, token: string) {
  const job = await jobFromCrewLink(deps, token);
  if (!job) throw new NotAllowedError("This crew link has stopped working.");
  return job;
}

export async function crewSimulateAction(token: string, form: FormData) {
  const deps = await getDeps();
  await attempt(`/crew/${token}`, async () => {
    const job = await crew(deps, token);
    await simulatePurchase(deps.db, {
      orgId: job.orgId,
      jobId: job.id,
      merchantName: text(form, "merchant") || "Test supplier",
      amountCents: cents(form, "amount"),
    });
  });
}

export async function crewCostAction(token: string, form: FormData) {
  const deps = await getDeps();
  await attempt(`/crew/${token}`, async () => {
    const job = await crew(deps, token);
    await addManualCost(deps.db, {
      orgId: job.orgId,
      jobId: job.id,
      description: text(form, "description") || "Cash purchase",
      amountCents: cents(form, "amount"),
    });
  });
}

export async function crewTypedNoteAction(token: string, form: FormData) {
  const deps = await getDeps();
  await attempt(`/crew/${token}`, async () => {
    const job = await crew(deps, token);
    const typedNote = text(form, "note");
    if (!typedNote) throw new NotAllowedError("Write a short note first.");
    await addVoiceNote(deps, { orgId: job.orgId, jobId: job.id, typedNote, actor: "crew" });
  });
}

export async function crewCloseAction(token: string, noteId: string, form: FormData) {
  const deps = await getDeps();
  await attempt(`/crew/${token}`, async () => {
    const job = await crew(deps, token);
    await closeJob(deps, {
      orgId: job.orgId,
      jobId: job.id,
      noteId,
      transcript: text(form, "transcript"),
      minutes: Math.round(Number(text(form, "hours") || 0) * 60),
      actor: "crew",
    });
  });
}
