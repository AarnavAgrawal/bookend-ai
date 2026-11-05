import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { jobs, transactions, webhookInbox } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { RampApiError } from "./client";
import { FakeRamp } from "./fake";
import { limitDecline, makeTxn, seedActiveJob } from "./testing";
import {
  InvalidWebhookError,
  MAX_ATTEMPTS,
  processInbox,
  receiveWebhook,
  verifyRampSignature,
} from "./webhooks";

const SECRET = "whsec_test";
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

const eventBody = (eventId: string, objectId: string, type = "transactions.cleared") =>
  JSON.stringify({
    id: eventId,
    type,
    created_at: "2026-11-05T22:02:31Z",
    business_id: "biz",
    object: { id: objectId },
  });

let db: Db;
let close: () => Promise<void>;
let ramp: FakeRamp;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ramp = new FakeRamp();
});
afterEach(() => close());

const deliver = (body: string) =>
  receiveWebhook(db, { rawBody: body, signature: sign(body), secret: SECRET });

describe("verifyRampSignature", () => {
  const body = eventBody("e1", "t1");

  it("accepts the HMAC of the raw body", () => {
    expect(verifyRampSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body changed in transit", () => {
    expect(verifyRampSignature(`${body} `, sign(body), SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyRampSignature(body, sign(body, "other"), SECRET)).toBe(false);
  });

  it("rejects a missing, truncated or non-hex signature", () => {
    expect(verifyRampSignature(body, null, SECRET)).toBe(false);
    expect(verifyRampSignature(body, sign(body).slice(0, 32), SECRET)).toBe(false);
    expect(verifyRampSignature(body, "not hex at all", SECRET)).toBe(false);
  });
});

describe("receiveWebhook", () => {
  it("stores nothing when the signature is bad", async () => {
    const body = eventBody("e1", "t1");
    await expect(
      receiveWebhook(db, { rawBody: body, signature: sign(body, "wrong"), secret: SECRET }),
    ).rejects.toBeInstanceOf(InvalidWebhookError);
    expect(await db.select().from(webhookInbox)).toHaveLength(0);
  });

  it("rejects a signed body it can't read", async () => {
    await expect(deliver("not json")).rejects.toBeInstanceOf(InvalidWebhookError);
    await expect(deliver(JSON.stringify({ id: "e1" }))).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("stores a redelivered event once", async () => {
    const body = eventBody("e1", "t1");
    expect(await deliver(body)).toBe("stored");
    expect(await deliver(body)).toBe("duplicate");
    expect(await db.select().from(webhookInbox)).toHaveLength(1);
  });

  it("doesn't call Ramp, so it can answer inside the 10-second window", async () => {
    await deliver(eventBody("e1", "t1"));
    expect(ramp.calls).toEqual([]);
  });
});

describe("processInbox", () => {
  it("re-fetches the transaction, because the payload has no amount", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    const txn = makeTxn(fundId, { amountCents: 12_345 });
    ramp.putTransaction(txn);
    await deliver(eventBody("e1", txn.id));

    expect(await processInbox(db, ramp)).toEqual({ processed: 1, failed: 0 });

    const rows = await db.select().from(transactions).where(eq(transactions.jobId, job.id));
    expect(rows).toMatchObject([{ rampTransactionId: txn.id, amountCents: 12_345 }]);
  });

  it("takes the current state when an old event is processed late", async () => {
    const { fundId } = await seedActiveJob(db, ramp);
    const txn = makeTxn(fundId, { state: "CLEARED" });
    ramp.putTransaction(txn);
    await deliver(eventBody("e1", txn.id, "transactions.authorized"));

    await processInbox(db, ramp);

    expect(await db.select().from(transactions)).toMatchObject([{ state: "CLEARED" }]);
  });

  it("opens a change order from a decline event", async () => {
    const { job, fundId } = await seedActiveJob(db, ramp);
    const decline = limitDecline(fundId, 100_000);
    ramp.putTransaction(decline);
    await deliver(eventBody("e1", decline.id, "transactions.declined"));

    await processInbox(db, ramp);

    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.state).toBe("change_pending");
  });

  it("finishes an event for a fund that isn't ours without error", async () => {
    await seedActiveJob(db, ramp);
    const txn = makeTxn("another-tenants-fund");
    ramp.putTransaction(txn);
    await deliver(eventBody("e1", txn.id));

    expect(await processInbox(db, ramp)).toEqual({ processed: 1, failed: 0 });
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it("marks event types it doesn't handle as done without calling Ramp", async () => {
    await deliver(eventBody("e1", "x1", "reimbursements.created"));
    expect(await processInbox(db, ramp)).toEqual({ processed: 1, failed: 0 });
    expect(ramp.calls).toEqual([]);
  });

  it("retries a failed event on the next run and clears its error", async () => {
    const { fundId } = await seedActiveJob(db, ramp);
    const txn = makeTxn(fundId);
    ramp.putTransaction(txn);
    await deliver(eventBody("e1", txn.id));
    ramp.failNext("getTransaction", new RampApiError(503, null, "down"));

    expect(await processInbox(db, ramp)).toEqual({ processed: 0, failed: 1 });
    expect((await db.select().from(webhookInbox))[0]).toMatchObject({ attempts: 1 });

    expect(await processInbox(db, ramp)).toEqual({ processed: 1, failed: 0 });
    const [event] = await db.select().from(webhookInbox);
    expect(event.error).toBeNull();
    expect(event.processedAt).not.toBeNull();
  });

  it("stops retrying a poison event, so it can't clog the queue forever", async () => {
    await deliver(eventBody("e1", "missing-transaction"));
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await processInbox(db, ramp);
    ramp.calls.length = 0;

    expect(await processInbox(db, ramp)).toEqual({ processed: 0, failed: 0 });
    expect(ramp.calls).toEqual([]);
    expect((await db.select().from(webhookInbox))[0].error).toContain("404");
  });

  it("does nothing twice", async () => {
    const { fundId } = await seedActiveJob(db, ramp);
    const txn = makeTxn(fundId);
    ramp.putTransaction(txn);
    await deliver(eventBody("e1", txn.id));
    await processInbox(db, ramp);
    ramp.calls.length = 0;

    expect(await processInbox(db, ramp)).toEqual({ processed: 0, failed: 0 });
    expect(ramp.calls).toEqual([]);
  });
});
