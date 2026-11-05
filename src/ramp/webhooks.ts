import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { webhookInbox } from "@/db/schema";
import type { RampClient } from "./client";
import { applyTransaction, type TransactionSource } from "./ledger";

/** After this many failures an event stops retrying. Reconcile still covers its data. */
export const MAX_ATTEMPTS = 10;

const eventSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  object: z.looseObject({ id: z.string() }),
});

export class InvalidWebhookError extends Error {
  constructor(reason: string) {
    super(`Rejected webhook: ${reason}`);
    this.name = "InvalidWebhookError";
  }
}

/** Ramp signs the raw bytes, so this must run before the body is parsed. */
export function verifyRampSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type ReceiveInput = {
  rawBody: string;
  signature: string | null;
  secret: string;
  source?: TransactionSource;
};

/** Only verifies and stores, so the route can answer inside Ramp's 10-second window. */
export async function receiveWebhook(
  db: Db,
  { rawBody, signature, secret, source = "ramp" }: ReceiveInput,
): Promise<"stored" | "duplicate"> {
  if (!verifyRampSignature(rawBody, signature, secret)) {
    throw new InvalidWebhookError("bad signature");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new InvalidWebhookError("body is not JSON");
  }
  const event = eventSchema.safeParse(parsed);
  if (!event.success) throw new InvalidWebhookError("unexpected shape");

  const inserted = await db
    .insert(webhookInbox)
    .values({
      eventId: event.data.id,
      type: event.data.type,
      rampObjectId: event.data.object.id,
      rawBody,
      source,
    })
    .onConflictDoNothing({ target: webhookInbox.eventId })
    .returning({ id: webhookInbox.id });
  return inserted.length > 0 ? "stored" : "duplicate";
}

export type ProcessResult = { processed: number; failed: number };

/**
 * Webhook payloads carry no amount, and may be old by the time they run, so each
 * one is only a prompt to re-fetch the transaction. Concurrent runs are safe:
 * applying the same transaction twice changes nothing.
 */
export async function processInbox(
  db: Db,
  ramp: RampClient,
  { batchSize = 50 }: { batchSize?: number } = {},
): Promise<ProcessResult> {
  const events = await db
    .select()
    .from(webhookInbox)
    .where(and(isNull(webhookInbox.processedAt), lt(webhookInbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(webhookInbox.receivedAt))
    .limit(batchSize);

  const result: ProcessResult = { processed: 0, failed: 0 };
  for (const event of events) {
    try {
      if (event.type.startsWith("transactions.")) {
        const txn = await ramp.getTransaction(event.rampObjectId);
        await applyTransaction(db, txn, event.source);
      }
      await db
        .update(webhookInbox)
        .set({ processedAt: new Date(), error: null })
        .where(eq(webhookInbox.id, event.id));
      result.processed += 1;
    } catch (error) {
      await db
        .update(webhookInbox)
        .set({
          attempts: event.attempts + 1,
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(webhookInbox.id, event.id));
      result.failed += 1;
    }
  }
  return result;
}
