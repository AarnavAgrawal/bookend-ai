import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobFunds, rampConnections } from "@/db/schema";
import { seedOrgWithJob } from "@/db/testing";
import { transitionJob } from "@/domain/jobs";
import type { JobEvent } from "@/domain/transition";
import type { RampTransaction } from "./client";
import type { FakeRamp } from "./fake";

/** Earlier than any test transaction, so test declines count as after the last raise. */
export const FUND_OPENED_AT = new Date("2026-01-01T00:00:00Z");

const TO_ACCEPTED: JobEvent[] = ["QUOTE_DRAFTED", "OWNER_APPROVED_QUOTE", "CUSTOMER_ACCEPTED"];

export async function seedAcceptedJob(db: Db, name?: string) {
  const { org, job } = await seedOrgWithJob(db, name);
  for (const event of TO_ACCEPTED) {
    await transitionJob(db, { orgId: org.id, jobId: job.id, event, actor: "test" });
  }
  await db.insert(rampConnections).values({
    orgId: org.id,
    mode: "shared_sandbox",
    fundOwnerUserId: "ramp-user-1",
  });
  return { org, job };
}

/** A job mid-flight with a card already open, on both our side and the fake's. */
export async function seedActiveJob(
  db: Db,
  ramp: FakeRamp,
  { limitCents = 90_000, name }: { limitCents?: number; name?: string } = {},
) {
  const { org, job } = await seedAcceptedJob(db, name);
  for (const event of ["CARD_OPEN_STARTED", "CARD_VERIFIED"] as const) {
    await transitionJob(db, { orgId: org.id, jobId: job.id, event, actor: "test" });
  }
  const fund = await ramp.createFund({
    idempotencyKey: randomUUID(),
    userId: "ramp-user-1",
    displayName: `Seed ${job.id}`,
    limitCents,
  });
  await db.insert(jobFunds).values({
    orgId: org.id,
    jobId: job.id,
    rampFundId: fund.id,
    rampCardId: fund.cardId,
    limitCents,
    limitChangedAt: FUND_OPENED_AT,
    state: "active",
  });
  return { org, job, fundId: fund.id };
}

export async function moveLimitChangedAt(db: Db, jobId: string, at: Date) {
  await db.update(jobFunds).set({ limitChangedAt: at }).where(eq(jobFunds.jobId, jobId));
}

export function makeTxn(fundId: string, overrides: Partial<RampTransaction> = {}): RampTransaction {
  return {
    id: randomUUID(),
    fundId,
    state: "CLEARED",
    amountCents: 10_000,
    merchantName: "Ferguson",
    declineReason: null,
    occurredAt: new Date("2026-06-01T12:00:00Z"),
    ...overrides,
  };
}

export const limitDecline = (fundId: string, amountCents: number, id?: string): RampTransaction =>
  makeTxn(fundId, {
    id: id ?? randomUUID(),
    state: "DECLINED",
    amountCents,
    declineReason: "AUTHORIZER_CARD_LIMIT",
  });
