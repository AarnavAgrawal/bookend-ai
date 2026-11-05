import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  approvals,
  changeOrders,
  jobFunds,
  jobs,
  rampConnections,
  rampOperations,
} from "@/db/schema";
import { transitionJob } from "@/domain/jobs";
import { canTransition, type JobEvent } from "@/domain/transition";
import { RampApiError, type RampClient, type RampFund } from "./client";

/**
 * The only module allowed to change money limits on Ramp. A static test fails
 * the build if anything else calls `createFund` or `setFundLimit`.
 *
 * Each write is: consume an approval and record an intent row in one database
 * transaction, call Ramp, read the result back, then record the outcome. A crash
 * at any step leaves a pending row that `resumePendingOperations` can finish.
 */

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ApprovalFailure = "invalid" | "consumed" | "expired" | "stale" | "changed";

export class ApprovalRejectedError extends Error {
  constructor(readonly reason: ApprovalFailure) {
    super(`Approval rejected: ${reason}`);
    this.name = "ApprovalRejectedError";
  }
}

/** Ramp accepted the call but the result isn't what was approved. */
export class RampWriteMismatchError extends Error {
  constructor(what: string) {
    super(`Ramp read-back mismatch: ${what}`);
    this.name = "RampWriteMismatchError";
  }
}

type Payload = Record<string, string | number>;

type OpenCardRequest = { fundName: string; userId: string; limitCents: number };
type RaiseLimitRequest = { rampFundId: string; changeOrderId: string; newLimitCents: number };

export type OperationStatus = "pending" | "succeeded" | "failed";

/** Unique per job, so a crashed create can find what it made. */
export const fundNameFor = (jobId: string) => `Bookend job ${jobId}`;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function hashPayload(payload: Payload): string {
  const sorted = Object.entries(payload).sort(([a], [b]) => a.localeCompare(b));
  return sha256(JSON.stringify(sorted));
}

async function lockJob(tx: Db, orgId: string, jobId: string) {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)))
    .for("update");
  if (!job) throw new ApprovalRejectedError("invalid");
  return job;
}

type IssueInput = {
  orgId: string;
  jobId: string;
  jobVersion: number;
  kind: "card_open" | "limit_raise";
  amountCents: number;
  payload: Payload;
  now: Date;
};

/** The token is returned once. Only its hash is stored. */
async function issueApproval(tx: Db, input: IssueInput): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.insert(approvals).values({
    orgId: input.orgId,
    jobId: input.jobId,
    kind: input.kind,
    amountCents: input.amountCents,
    payloadHash: hashPayload(input.payload),
    tokenHash: sha256(token),
    jobVersion: input.jobVersion,
    expiresAt: new Date(input.now.getTime() + APPROVAL_TTL_MS),
  });
  return token;
}

type ConsumeInput = {
  orgId: string;
  token: string;
  kind: "card_open" | "limit_raise";
  approvedBy: string;
  now: Date;
  /** What is true now. The approval must match it, not just exist. */
  currentPayload: (approval: typeof approvals.$inferSelect) => Promise<Payload>;
};

async function consumeApproval(tx: Db, input: ConsumeInput) {
  const { orgId, token, kind, approvedBy, now, currentPayload } = input;
  const [approval] = await tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.tokenHash, sha256(token)), eq(approvals.orgId, orgId)))
    .for("update");
  if (!approval || approval.kind !== kind) throw new ApprovalRejectedError("invalid");
  if (approval.consumedAt) throw new ApprovalRejectedError("consumed");
  if (approval.expiresAt <= now) throw new ApprovalRejectedError("expired");

  const job = await lockJob(tx, orgId, approval.jobId);
  if (job.version !== approval.jobVersion) throw new ApprovalRejectedError("stale");
  if (hashPayload(await currentPayload(approval)) !== approval.payloadHash) {
    throw new ApprovalRejectedError("changed");
  }

  await tx
    .update(approvals)
    .set({ consumedAt: now, approvedBy })
    .where(eq(approvals.id, approval.id));
  return approval;
}

const cardOpenPayload = (jobId: string, limitCents: number): Payload => ({
  kind: "card_open",
  jobId,
  limitCents,
});

export async function requestCardOpen(
  db: Db,
  input: { orgId: string; jobId: string; limitCents: number; now?: Date },
): Promise<{ token: string }> {
  const { orgId, jobId, limitCents, now = new Date() } = input;
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, orgId, jobId);
    if (!canTransition(job.state, "CARD_OPEN_STARTED")) throw new ApprovalRejectedError("stale");
    const token = await issueApproval(tx, {
      orgId,
      jobId,
      jobVersion: job.version,
      kind: "card_open",
      amountCents: limitCents,
      payload: cardOpenPayload(jobId, limitCents),
      now,
    });
    return { token };
  });
}

export async function approveCardOpen(
  db: Db,
  ramp: RampClient,
  input: {
    orgId: string;
    token: string;
    approvedBy: string;
    /** The limit the current quote implies, computed by the caller's domain code. */
    expectedLimitCents: number;
    now?: Date;
  },
): Promise<OperationStatus> {
  const { orgId, token, approvedBy, expectedLimitCents, now = new Date() } = input;
  const operationId = await db.transaction(async (tx) => {
    const approval = await consumeApproval(tx, {
      orgId,
      token,
      kind: "card_open",
      approvedBy,
      now,
      currentPayload: async (a) => cardOpenPayload(a.jobId, expectedLimitCents),
    });
    const [connection] = await tx
      .select({ userId: rampConnections.fundOwnerUserId })
      .from(rampConnections)
      .where(eq(rampConnections.orgId, orgId));
    if (!connection?.userId) throw new Error("Org has no Ramp fund owner configured");

    const request: OpenCardRequest = {
      fundName: fundNameFor(approval.jobId),
      userId: connection.userId,
      limitCents: approval.amountCents,
    };
    const [operation] = await tx
      .insert(rampOperations)
      .values({
        orgId,
        jobId: approval.jobId,
        approvalId: approval.id,
        kind: "open_card",
        idempotencyKey: randomUUID(),
        status: "pending",
        request,
      })
      .returning({ id: rampOperations.id });
    await transitionJob(tx, {
      orgId,
      jobId: approval.jobId,
      event: "CARD_OPEN_STARTED",
      actor: approvedBy,
    });
    return operation.id;
  });
  return executeOperation(db, ramp, operationId);
}

const limitRaisePayload = (changeOrderId: string, newLimitCents: number): Payload => ({
  kind: "limit_raise",
  changeOrderId,
  newLimitCents,
});

async function openChangeOrder(tx: Db, jobId: string) {
  const [changeOrder] = await tx
    .select()
    .from(changeOrders)
    .where(and(eq(changeOrders.jobId, jobId), eq(changeOrders.ownerStatus, "pending")));
  return changeOrder;
}

export async function requestLimitRaise(
  db: Db,
  input: { orgId: string; jobId: string; now?: Date },
): Promise<{ token: string; newLimitCents: number }> {
  const { orgId, jobId, now = new Date() } = input;
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, orgId, jobId);
    const changeOrder = await openChangeOrder(tx, jobId);
    if (!changeOrder) throw new ApprovalRejectedError("stale");
    const newLimitCents = changeOrder.requestedLimitCents;
    const token = await issueApproval(tx, {
      orgId,
      jobId,
      jobVersion: job.version,
      kind: "limit_raise",
      amountCents: newLimitCents,
      payload: limitRaisePayload(changeOrder.id, newLimitCents),
      now,
    });
    return { token, newLimitCents };
  });
}

export async function approveLimitRaise(
  db: Db,
  ramp: RampClient,
  input: { orgId: string; token: string; approvedBy: string; now?: Date },
): Promise<OperationStatus> {
  const { orgId, token, approvedBy, now = new Date() } = input;
  const operationId = await db.transaction(async (tx) => {
    let changeOrderId: string | null = null;
    const approval = await consumeApproval(tx, {
      orgId,
      token,
      kind: "limit_raise",
      approvedBy,
      now,
      // Reads the change order as it is now: a retry at the counter may have
      // resized it since the owner was shown the amount.
      currentPayload: async (a) => {
        const changeOrder = await openChangeOrder(tx, a.jobId);
        if (!changeOrder) throw new ApprovalRejectedError("stale");
        changeOrderId = changeOrder.id;
        return limitRaisePayload(changeOrder.id, changeOrder.requestedLimitCents);
      },
    });
    if (!changeOrderId) throw new ApprovalRejectedError("stale");

    const [fund] = await tx
      .select({ rampFundId: jobFunds.rampFundId })
      .from(jobFunds)
      .where(eq(jobFunds.jobId, approval.jobId));
    if (!fund) throw new ApprovalRejectedError("stale");

    const request: RaiseLimitRequest = {
      rampFundId: fund.rampFundId,
      changeOrderId,
      newLimitCents: approval.amountCents,
    };
    const [operation] = await tx
      .insert(rampOperations)
      .values({
        orgId,
        jobId: approval.jobId,
        approvalId: approval.id,
        kind: "raise_limit",
        idempotencyKey: randomUUID(),
        status: "pending",
        request,
      })
      .returning({ id: rampOperations.id });
    return operation.id;
  });
  return executeOperation(db, ramp, operationId);
}

function assertFund(fund: RampFund, limitCents: number) {
  if (fund.limitCents !== limitCents) {
    throw new RampWriteMismatchError(`limit is ${fund.limitCents}, expected ${limitCents}`);
  }
  if (fund.state !== "ACTIVE") throw new RampWriteMismatchError(`fund state is ${fund.state}`);
}

async function performOpenCard(ramp: RampClient, key: string, request: OpenCardRequest) {
  // Ramp answers a reused idempotency key with an error, not the original fund,
  // so a retry after a lost response has to find the fund by name first.
  const fund =
    (await ramp.findFundByName(request.fundName)) ??
    (await ramp.createFund({
      idempotencyKey: key,
      userId: request.userId,
      displayName: request.fundName,
      limitCents: request.limitCents,
    }));
  const readBack = await ramp.getFund(fund.id);
  assertFund(readBack, request.limitCents);
  return readBack;
}

async function performRaiseLimit(ramp: RampClient, request: RaiseLimitRequest) {
  // Setting an absolute limit is naturally safe to repeat.
  await ramp.setFundLimit(request.rampFundId, request.newLimitCents);
  const readBack = await ramp.getFund(request.rampFundId);
  assertFund(readBack, request.newLimitCents);
  return readBack;
}

function isTransient(error: unknown): boolean {
  if (error instanceof RampApiError) return error.transient;
  if (!(error instanceof Error)) return false;
  // What fetch throws for network loss and timeouts.
  return error.name === "TimeoutError" || error.message === "fetch failed";
}

/** Safe to call repeatedly: finished operations return without touching Ramp. */
export async function executeOperation(
  db: Db,
  ramp: RampClient,
  operationId: string,
): Promise<OperationStatus> {
  const [operation] = await db
    .select()
    .from(rampOperations)
    .where(eq(rampOperations.id, operationId));
  if (!operation) throw new Error(`Operation not found: ${operationId}`);
  if (operation.status !== "pending") return operation.status;

  try {
    if (operation.kind === "open_card") {
      const request = operation.request as OpenCardRequest;
      const fund = await performOpenCard(ramp, operation.idempotencyKey, request);
      await finish(db, operationId, async (tx) => {
        await tx
          .insert(jobFunds)
          .values({
            orgId: operation.orgId,
            jobId: operation.jobId,
            rampFundId: fund.id,
            rampCardId: fund.cardId,
            limitCents: fund.limitCents,
            state: "active",
          })
          .onConflictDoNothing({ target: jobFunds.jobId });
        return { event: "CARD_VERIFIED", response: { fundId: fund.id, cardId: fund.cardId } };
      });
    } else {
      const request = operation.request as RaiseLimitRequest;
      const fund = await performRaiseLimit(ramp, request);
      await finish(db, operationId, async (tx) => {
        await tx
          .update(jobFunds)
          .set({ limitCents: fund.limitCents, limitChangedAt: new Date() })
          .where(eq(jobFunds.jobId, operation.jobId));
        await tx
          .update(jobs)
          .set({ nearLimitWarnedAt: null })
          .where(eq(jobs.id, operation.jobId));
        await tx
          .update(changeOrders)
          .set({ ownerStatus: "approved" })
          .where(eq(changeOrders.id, request.changeOrderId));
        return { event: "CHANGE_RESOLVED", response: { limitCents: fund.limitCents } };
      });
    }
    return "succeeded";
  } catch (error) {
    if (isTransient(error)) return "pending";
    await db
      .update(rampOperations)
      .set({
        status: "failed",
        response: { error: error instanceof Error ? error.message : String(error) },
      })
      .where(eq(rampOperations.id, operationId));
    return "failed";
  }
}

async function finish(
  db: Db,
  operationId: string,
  apply: (tx: Db) => Promise<{ event: JobEvent; response: Record<string, unknown> }>,
) {
  await db.transaction(async (tx) => {
    const [operation] = await tx
      .select()
      .from(rampOperations)
      .where(eq(rampOperations.id, operationId))
      .for("update");
    // Two workers can reach this point. The first one wins.
    if (operation.status !== "pending") return;

    const { event, response } = await apply(tx);
    await tx
      .update(rampOperations)
      .set({ status: "succeeded", response })
      .where(eq(rampOperations.id, operationId));
    await transitionJob(tx, {
      orgId: operation.orgId,
      jobId: operation.jobId,
      event,
      actor: "system",
      data: { operationId },
    });
  });
}

/** Finishes writes interrupted by a crash or an outage. Runs from the minute cron. */
export async function resumePendingOperations(
  db: Db,
  ramp: RampClient,
): Promise<Record<OperationStatus, number>> {
  const pending = await db
    .select({ id: rampOperations.id })
    .from(rampOperations)
    .where(eq(rampOperations.status, "pending"));

  const counts: Record<OperationStatus, number> = { pending: 0, succeeded: 0, failed: 0 };
  for (const { id } of pending) {
    counts[await executeOperation(db, ramp, id)] += 1;
  }
  return counts;
}
