import { and, desc, eq, gte, isNotNull, max, count } from "drizzle-orm";
import { MODEL, AiUnavailableError } from "@/ai/claude";
import { priceProposal, QUOTE_PROMPT_VERSION, runQuoteAgent } from "@/ai/quote-agent";
import type { Db } from "@/db/client";
import {
  changeOrders,
  customers,
  jobEvents,
  jobs,
  orgs,
  outboxMessages,
  quoteLines,
  quotes,
  rampConnections,
} from "@/db/schema";
import { transitionJob } from "@/domain/jobs";
import { applyBps } from "@/domain/money";
import { cardLimitForQuote, priceLine, summarizeQuote, type LineInput } from "@/domain/quote";
import type { Email } from "@/platform/email";
import { signLink, verifyLink } from "@/platform/links";
import type { Deps } from "@/platform/deps";
import {
  ApprovalRejectedError,
  approveCardOpen,
  approveLimitRaise,
  findApproval,
  requestCardOpen,
  requestLimitRaise,
  type OperationStatus,
} from "@/ramp/guard";

export class NotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAllowedError";
  }
}

export const MONTHLY_AI_LIMIT = Number(process.env.MONTHLY_AI_LIMIT ?? 300);

/** Records the message first, so a failed or unconfigured email can't lose a link. */
export async function notify(
  deps: Pick<Deps, "db" | "mailer">,
  input: Omit<Email, "to"> & { orgId: string; jobId?: string; to: string | null },
): Promise<void> {
  const { orgId, jobId, to, subject, text, attachments } = input;
  const base = { orgId, jobId, toAddress: to, subject, body: text };
  if (!to) {
    await deps.db.insert(outboxMessages).values({ ...base, provider: "local", status: "logged" });
    return;
  }
  try {
    const result = await deps.mailer.send({ to, subject, text, attachments });
    await deps.db.insert(outboxMessages).values({ ...base, ...result });
  } catch (error) {
    await deps.db.insert(outboxMessages).values({
      ...base,
      provider: "resend",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadJob(db: Db, orgId: string, jobId: string) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)));
  if (!job) throw new NotAllowedError("Job not found");
  return job;
}

export async function loadOrg(db: Db, orgId: string) {
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) throw new NotAllowedError("Org not found");
  return org;
}

export async function latestQuote(db: Db, jobId: string) {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.jobId, jobId))
    .orderBy(desc(quotes.version))
    .limit(1);
  return quote ?? null;
}

export async function createJob(
  db: Db,
  input: {
    orgId: string;
    title: string;
    description?: string;
    customer: { name: string; email?: string; phone?: string; address?: string };
  },
) {
  const { orgId, title, description, customer } = input;
  return db.transaction(async (tx) => {
    // Numbers must be unique per org, so job creation queues behind this lock.
    await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId)).for("update");
    const [{ highest }] = await tx
      .select({ highest: max(jobs.jobNumber) })
      .from(jobs)
      .where(eq(jobs.orgId, orgId));
    const [newCustomer] = await tx
      .insert(customers)
      .values({ orgId, ...customer })
      .returning({ id: customers.id });
    const [job] = await tx
      .insert(jobs)
      .values({
        orgId,
        customerId: newCustomer.id,
        jobNumber: (highest ?? 0) + 1,
        title,
        description,
      })
      .returning();
    return job;
  });
}

export async function saveQuote(
  db: Db,
  input: {
    orgId: string;
    jobId: string;
    lines: LineInput[];
    assumptions?: string;
    draftedBy: "agent" | "owner";
    actor: string;
  },
) {
  const { orgId, jobId, lines, assumptions, draftedBy, actor } = input;
  if (lines.length === 0) throw new NotAllowedError("A quote needs at least one line");
  const org = await loadOrg(db, orgId);
  const priced = lines.map((line) => priceLine(line, org));
  const totals = summarizeQuote(priced, org.taxRateBps);

  return db.transaction(async (tx) => {
    const job = await loadJob(tx, orgId, jobId);
    if (job.state !== "draft" && job.state !== "quote_review") {
      throw new NotAllowedError("This quote has already been sent");
    }
    const previous = await latestQuote(tx, jobId);
    const [quote] = await tx
      .insert(quotes)
      .values({
        orgId,
        jobId,
        version: (previous?.version ?? 0) + 1,
        assumptions,
        draftedBy,
        ...totals,
      })
      .returning();
    await tx.insert(quoteLines).values(priced.map((l) => ({ ...l, orgId, quoteId: quote.id })));
    if (job.state === "draft") {
      await transitionJob(tx, { orgId, jobId, event: "QUOTE_DRAFTED", actor });
    }
    return quote;
  });
}

async function aiCallsThisMonth(db: Db, orgId: string, now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [{ calls }] = await db
    .select({ calls: count() })
    .from(jobEvents)
    .where(
      and(
        eq(jobEvents.orgId, orgId),
        isNotNull(jobEvents.model),
        gte(jobEvents.createdAt, start),
      ),
    );
  return calls;
}

/** Stops one signup from running up an unbounded Claude bill. */
export async function assertAiBudget(db: Db, orgId: string, now = new Date()) {
  if ((await aiCallsThisMonth(db, orgId, now)) >= MONTHLY_AI_LIMIT) {
    throw new NotAllowedError("This month's AI allowance is used up. Enter it by hand for now.");
  }
}

export async function recordAiUse(
  db: Db,
  input: { orgId: string; jobId: string; type: string; promptVersion: string; actor: string },
) {
  await db.insert(jobEvents).values({ ...input, model: MODEL });
}

export async function draftQuoteWithAgent(
  deps: Pick<Deps, "db" | "claude">,
  input: { orgId: string; jobId: string; actor: string },
) {
  const { db, claude } = deps;
  const { orgId, jobId, actor } = input;
  if (!claude) throw new AiUnavailableError();
  await assertAiBudget(db, orgId);
  const job = await loadJob(db, orgId, jobId);
  const proposal = await runQuoteAgent(db, claude, {
    orgId,
    title: job.title,
    description: job.description,
  });
  const lines = await priceProposal(db, orgId, proposal);
  const quote = await saveQuote(db, {
    orgId,
    jobId,
    lines,
    assumptions: proposal.assumptions,
    draftedBy: "agent",
    actor,
  });
  await recordAiUse(db, {
    orgId,
    jobId,
    type: "QUOTE_AGENT_RUN",
    promptVersion: QUOTE_PROMPT_VERSION,
    actor,
  });
  return quote;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function customerOf(db: Db, customerId: string | null) {
  if (!customerId) return null;
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  return customer ?? null;
}

export const quoteUrl = (deps: Pick<Deps, "secret" | "appUrl">, quoteId: string) =>
  `${deps.appUrl}/q/${signLink("quote", quoteId, deps.secret)}`;

export const crewUrl = (deps: Pick<Deps, "secret" | "appUrl">, jobId: string) =>
  `${deps.appUrl}/crew/${signLink("crew", jobId, deps.secret)}`;

/** The owner authorizes the price here. Spending needs its own approval later. */
export async function sendQuoteToCustomer(
  deps: Pick<Deps, "db" | "mailer" | "secret" | "appUrl">,
  input: { orgId: string; jobId: string; expectedVersion: number; actor: string },
) {
  const { db } = deps;
  const { orgId, jobId, expectedVersion, actor } = input;
  const quote = await latestQuote(db, jobId);
  if (!quote) throw new NotAllowedError("There's no quote to send");
  await transitionJob(db, {
    orgId,
    jobId,
    event: "OWNER_APPROVED_QUOTE",
    actor,
    expectedVersion,
    data: { quoteVersion: quote.version },
  });
  const job = await loadJob(db, orgId, jobId);
  const org = await loadOrg(db, orgId);
  const customer = await customerOf(db, job.customerId);
  const url = quoteUrl(deps, quote.id);
  await notify(deps, {
    orgId,
    jobId,
    to: customer?.email ?? null,
    subject: `Your quote from ${org.name}: ${job.title}`,
    text: `${org.name} sent you a quote for ${job.title}, total ${money(quote.totalCents)}.\n\nReview and accept it here:\n${url}`,
  });
  return { url };
}

async function markAccepted(
  db: Db,
  input: { orgId: string; jobId: string; quoteId: string; via: "customer_link" | "owner_recorded" },
) {
  const { orgId, jobId, quoteId, via } = input;
  await db.transaction(async (tx) => {
    await transitionJob(tx, {
      orgId,
      jobId,
      event: "CUSTOMER_ACCEPTED",
      actor: via === "customer_link" ? "customer" : "owner",
      data: { quoteId },
    });
    await tx
      .update(quotes)
      .set({ acceptedAt: new Date(), acceptedVia: via })
      .where(eq(quotes.id, quoteId));
  });
}

/** Resolves a customer's link. Null means the link is bad or the quote has moved on. */
export async function quoteFromLink(deps: Pick<Deps, "db" | "secret">, token: string) {
  const quoteId = verifyLink("quote", token, deps.secret);
  if (!quoteId) return null;
  const [quote] = await deps.db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!quote) return null;
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, quote.jobId));
  const lines = await deps.db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id));
  const org = await loadOrg(deps.db, quote.orgId);
  return { quote, job, lines, org };
}

export async function acceptQuoteFromLink(deps: Pick<Deps, "db" | "secret">, token: string) {
  const found = await quoteFromLink(deps, token);
  if (!found) throw new NotAllowedError("This link isn't valid");
  const { quote, job } = found;
  const current = await latestQuote(deps.db, job.id);
  if (job.state !== "quote_sent" || current?.id !== quote.id) {
    throw new NotAllowedError("This quote is no longer open");
  }
  await markAccepted(deps.db, {
    orgId: quote.orgId,
    jobId: job.id,
    quoteId: quote.id,
    via: "customer_link",
  });
}

export async function recordVerbalAcceptance(db: Db, input: { orgId: string; jobId: string }) {
  const quote = await latestQuote(db, input.jobId);
  if (!quote) throw new NotAllowedError("There's no quote to accept");
  await markAccepted(db, { ...input, quoteId: quote.id, via: "owner_recorded" });
}

export const approvalUrl = (appUrl: string, token: string) => `${appUrl}/approve/${token}`;

export async function requestCard(
  deps: Pick<Deps, "db" | "mailer" | "appUrl">,
  input: { orgId: string; jobId: string },
) {
  const { db } = deps;
  const { orgId, jobId } = input;
  const quote = await latestQuote(db, jobId);
  if (!quote) throw new NotAllowedError("There's no quote for this job");
  const org = await loadOrg(db, orgId);
  const job = await loadJob(db, orgId, jobId);
  const limitCents = cardLimitForQuote(quote, org);
  const { token } = await requestCardOpen(db, { orgId, jobId, limitCents });
  const url = approvalUrl(deps.appUrl, token);
  await notify(deps, {
    orgId,
    jobId,
    to: org.contactEmail,
    subject: `Approve a ${money(limitCents)} card for ${job.title}`,
    text: `Confirm opening a job card limited to ${money(limitCents)}:\n${url}`,
  });
  return { url, limitCents };
}

export async function requestRaise(
  deps: Pick<Deps, "db" | "mailer" | "appUrl">,
  input: { orgId: string; jobId: string },
) {
  const { db } = deps;
  const { orgId, jobId } = input;
  const org = await loadOrg(db, orgId);
  const job = await loadJob(db, orgId, jobId);
  const { token, newLimitCents } = await requestLimitRaise(db, { orgId, jobId });
  const url = approvalUrl(deps.appUrl, token);
  await notify(deps, {
    orgId,
    jobId,
    to: org.contactEmail,
    subject: `${job.title} needs a limit of ${money(newLimitCents)}`,
    text: `The card was declined. Confirm raising its limit to ${money(newLimitCents)}:\n${url}`,
  });
  return { url, newLimitCents };
}

/** What the approval page shows. Doesn't consume the token. */
export async function describeApproval(db: Db, token: string) {
  const approval = await findApproval(db, token);
  if (!approval) return null;
  const job = await loadJob(db, approval.orgId, approval.jobId);
  return { approval, job };
}

export async function confirmApproval(
  deps: Pick<Deps, "db" | "ramp" | "mailer" | "secret" | "appUrl">,
  input: { token: string; approvedBy: string },
): Promise<OperationStatus> {
  const { db, ramp } = deps;
  const { token, approvedBy } = input;
  if (!ramp) throw new NotAllowedError("Ramp isn't connected");
  const approval = await findApproval(db, token);
  if (!approval) throw new ApprovalRejectedError("invalid");
  const { orgId, jobId } = approval;

  if (approval.kind === "limit_raise") {
    const [open] = await db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.jobId, jobId), eq(changeOrders.ownerStatus, "pending")));
    const status = await approveLimitRaise(db, ramp, { orgId, token, approvedBy });
    if (status === "succeeded" && open) await offerChangeOrderToCustomer(deps, open.id);
    return status;
  }

  const quote = await latestQuote(db, jobId);
  if (!quote) throw new ApprovalRejectedError("stale");
  const org = await loadOrg(db, orgId);
  return approveCardOpen(db, ramp, {
    orgId,
    token,
    approvedBy,
    expectedLimitCents: cardLimitForQuote(quote, org),
  });
}

/**
 * Customer acceptance gates billing, not the limit raise, so the crew isn't left
 * standing at a counter. What the customer owes for the extra materials is the
 * increase plus the org's usual markup.
 */
async function offerChangeOrderToCustomer(
  deps: Pick<Deps, "db" | "mailer" | "secret" | "appUrl">,
  changeOrderId: string,
) {
  const { db } = deps;
  const [order] = await db.select().from(changeOrders).where(eq(changeOrders.id, changeOrderId));
  const org = await loadOrg(db, order.orgId);
  const job = await loadJob(db, order.orgId, order.jobId);
  const customer = await customerOf(db, job.customerId);
  const sellAmountCents = order.declinedCents + applyBps(order.declinedCents, org.markupBps);
  await db.update(changeOrders).set({ sellAmountCents }).where(eq(changeOrders.id, order.id));
  await notify(deps, {
    orgId: order.orgId,
    jobId: job.id,
    to: customer?.email ?? null,
    subject: `Change to your job: ${job.title}`,
    text: `${order.reason ?? "This job needs extra materials."}\n\nAdditional cost: ${money(sellAmountCents)}.\n\nReview it here:\n${changeOrderUrl(deps, order.id)}`,
  });
}

export const changeOrderUrl = (deps: Pick<Deps, "secret" | "appUrl">, id: string) =>
  `${deps.appUrl}/c/${signLink("change_order", id, deps.secret)}`;

export async function changeOrderFromLink(deps: Pick<Deps, "db" | "secret">, token: string) {
  const id = verifyLink("change_order", token, deps.secret);
  if (!id) return null;
  const [order] = await deps.db.select().from(changeOrders).where(eq(changeOrders.id, id));
  if (!order) return null;
  const job = await loadJob(deps.db, order.orgId, order.jobId);
  const org = await loadOrg(deps.db, order.orgId);
  return { order, job, org };
}

export async function respondToChangeOrder(
  deps: Pick<Deps, "db" | "secret">,
  input: { token: string; accepted: boolean },
) {
  const found = await changeOrderFromLink(deps, input.token);
  if (!found) throw new NotAllowedError("This link isn't valid");
  if (found.order.customerStatus !== "pending") {
    throw new NotAllowedError("You've already responded to this change");
  }
  await deps.db
    .update(changeOrders)
    .set({ customerStatus: input.accepted ? "accepted" : "rejected" })
    .where(eq(changeOrders.id, found.order.id));
}

export async function recordCustomerResponseByOwner(
  db: Db,
  input: { orgId: string; changeOrderId: string; accepted: boolean },
) {
  await db
    .update(changeOrders)
    .set({ customerStatus: input.accepted ? "accepted" : "rejected" })
    .where(and(eq(changeOrders.id, input.changeOrderId), eq(changeOrders.orgId, input.orgId)));
}

/** The owner says no. The limit stays where it is and the crew carries on within it. */
export async function rejectChangeOrder(db: Db, input: { orgId: string; jobId: string }) {
  const { orgId, jobId } = input;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(changeOrders)
      .set({ ownerStatus: "rejected", customerStatus: "rejected" })
      .where(
        and(
          eq(changeOrders.jobId, jobId),
          eq(changeOrders.orgId, orgId),
          eq(changeOrders.ownerStatus, "pending"),
        ),
      )
      .returning({ id: changeOrders.id });
    if (updated.length === 0) throw new NotAllowedError("No open change order");
    await transitionJob(tx, { orgId, jobId, event: "CHANGE_RESOLVED", actor: "owner" });
  });
}

/** Picks the first active non-guest as the fund owner, since guests can't hold spend. */
export async function connectRamp(
  deps: Pick<Deps, "db" | "ramp">,
  input: { orgId: string; mode?: "shared_sandbox" | "sandbox" | "production" },
) {
  const { db, ramp } = deps;
  if (!ramp) throw new NotAllowedError("Ramp credentials aren't configured");
  const users = await ramp.listUsers();
  const owner = users.find((u) => u.role !== "GUEST_USER" && u.status === "USER_ACTIVE");
  if (!owner) throw new NotAllowedError("No active Ramp user can own job cards");
  const values = { fundOwnerUserId: owner.id, mode: input.mode ?? ("shared_sandbox" as const) };
  await db
    .insert(rampConnections)
    .values({ orgId: input.orgId, ...values })
    .onConflictDoUpdate({ target: rampConnections.orgId, set: values });
}
