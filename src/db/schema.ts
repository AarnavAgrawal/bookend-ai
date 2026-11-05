import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { JOB_STATES } from "@/domain/transition";

/** Money columns hold integer cents. bigint in "number" mode stays exact below 2^53. */
const cents = (name: string) => bigint(name, { mode: "number" });
const id = () => uuid("id").primaryKey().defaultRandom();
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => orgs.id);
const jobId = () =>
  uuid("job_id")
    .notNull()
    .references(() => jobs.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const jobStateEnum = pgEnum("job_state", JOB_STATES);

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  clerkOrgId: text("clerk_org_id").unique(),
  laborCostCentsPerHour: cents("labor_cost_cents_per_hour").notNull().default(0),
  laborBillCentsPerHour: cents("labor_bill_cents_per_hour").notNull().default(0),
  markupBps: integer("markup_bps").notNull().default(0),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  cardBufferCents: cents("card_buffer_cents").notNull().default(0),
  attachReceiptsToInvoice: boolean("attach_receipts_to_invoice").notNull().default(true),
  createdAt: createdAt(),
});

export const members = pgTable(
  "members",
  {
    id: id(),
    orgId: orgId(),
    clerkUserId: text("clerk_user_id"),
    name: text("name").notNull(),
    role: text("role", { enum: ["owner", "crew"] }).notNull(),
    rampUserId: text("ramp_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("members_org_clerk_user").on(t.orgId, t.clerkUserId)],
);

export const rampConnections = pgTable("ramp_connections", {
  id: id(),
  orgId: orgId().unique(),
  mode: text("mode", { enum: ["shared_sandbox", "sandbox", "production"] }).notNull(),
  encryptedCredentials: text("encrypted_credentials"),
  /** The Ramp user who owns this org's job funds. Guests can't hold spend. */
  fundOwnerUserId: text("fund_owner_user_id"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const customers = pgTable("customers", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    orgId: orgId(),
    customerId: uuid("customer_id").references(() => customers.id),
    jobNumber: integer("job_number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    state: jobStateEnum("state").notNull().default("draft"),
    version: integer("version").notNull().default(0),
    nearLimitWarnedAt: timestamp("near_limit_warned_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_org_number").on(t.orgId, t.jobNumber), index("jobs_org_state").on(t.orgId, t.state)],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    orgId: orgId(),
    jobId: jobId(),
    version: integer("version").notNull(),
    materialsCostCents: cents("materials_cost_cents").notNull(),
    subtotalSellCents: cents("subtotal_sell_cents").notNull(),
    taxCents: cents("tax_cents").notNull(),
    totalCents: cents("total_cents").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedVia: text("accepted_via", { enum: ["customer_link", "owner_recorded"] }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quotes_job_version").on(t.jobId, t.version)],
);

export const quoteLines = pgTable("quote_lines", {
  id: id(),
  orgId: orgId(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id),
  kind: text("kind", { enum: ["material", "labor", "other"] }).notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitCostCents: cents("unit_cost_cents").notNull(),
  unitSellCents: cents("unit_sell_cents").notNull(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  isEstimate: boolean("is_estimate").notNull().default(false),
});

export const priceObservations = pgTable(
  "price_observations",
  {
    id: id(),
    orgId: orgId(),
    item: text("item").notNull(),
    unitCostCents: cents("unit_cost_cents").notNull(),
    source: text("source", {
      enum: ["ramp_receipt", "ramp_merchant_data", "price_book", "csv", "closed_job"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("price_obs_source").on(t.orgId, t.source, t.sourceId, t.item),
    index("price_obs_org_item").on(t.orgId, t.item),
  ],
);

export const approvals = pgTable("approvals", {
  id: id(),
  orgId: orgId(),
  jobId: jobId(),
  kind: text("kind", { enum: ["card_open", "limit_raise"] }).notNull(),
  amountCents: cents("amount_cents").notNull(),
  payloadHash: text("payload_hash").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  jobVersion: integer("job_version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
  createdAt: createdAt(),
});

export const jobFunds = pgTable("job_funds", {
  id: id(),
  orgId: orgId(),
  jobId: jobId().unique(),
  rampFundId: text("ramp_fund_id").notNull().unique(),
  rampCardId: text("ramp_card_id"),
  limitCents: cents("limit_cents").notNull(),
  /** Declines from before this moment can't open a change order: the limit has moved on. */
  limitChangedAt: timestamp("limit_changed_at", { withTimezone: true }).notNull().defaultNow(),
  state: text("state", { enum: ["active", "suspended", "terminated"] }).notNull(),
  createdAt: createdAt(),
});

/** Intent is written before Ramp is called, so a crash can never lose track of a write. */
export const rampOperations = pgTable("ramp_operations", {
  id: id(),
  orgId: orgId(),
  jobId: jobId(),
  approvalId: uuid("approval_id")
    .notNull()
    .unique()
    .references(() => approvals.id),
  kind: text("kind", { enum: ["open_card", "raise_limit"] }).notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull(),
  request: jsonb("request").notNull(),
  response: jsonb("response"),
  createdAt: createdAt(),
});

export const webhookInbox = pgTable("webhook_inbox", {
  id: id(),
  eventId: text("event_id").notNull().unique(),
  type: text("type").notNull(),
  rampObjectId: text("ramp_object_id").notNull(),
  rawBody: text("raw_body").notNull(),
  source: text("source", { enum: ["ramp", "simulated"] }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
});

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    orgId: orgId(),
    jobId: jobId(),
    rampTransactionId: text("ramp_transaction_id").notNull().unique(),
    state: text("state", {
      enum: ["CLEARED", "COMPLETION", "DECLINED", "ERROR", "PENDING", "PENDING_INITIATION"],
    }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    merchantName: text("merchant_name"),
    declineReason: text("decline_reason"),
    /** Set on a limit decline once a change order covers it, so it's only counted once. */
    changeOrderId: uuid("change_order_id").references(() => changeOrders.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    source: text("source", { enum: ["ramp", "simulated"] }).notNull().default("ramp"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transactions_job").on(t.jobId)],
);

export const receipts = pgTable("receipts", {
  id: id(),
  orgId: orgId(),
  jobId: jobId(),
  transactionId: uuid("transaction_id").references(() => transactions.id),
  blobKey: text("blob_key").notNull(),
  extraction: jsonb("extraction"),
  matchStatus: text("match_status", { enum: ["unmatched", "matched", "needs_review"] })
    .notNull()
    .default("unmatched"),
  createdAt: createdAt(),
});

export const voiceNotes = pgTable("voice_notes", {
  id: id(),
  orgId: orgId(),
  jobId: jobId(),
  blobKey: text("blob_key").notNull(),
  transcript: text("transcript"),
  extraction: jsonb("extraction"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const changeOrders = pgTable(
  "change_orders",
  {
    id: id(),
    orgId: orgId(),
    jobId: jobId(),
    declinedCents: cents("declined_cents").notNull(),
    requestedLimitCents: cents("requested_limit_cents").notNull(),
    sellAmountCents: cents("sell_amount_cents"),
    reason: text("reason"),
    ownerStatus: text("owner_status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    customerStatus: text("customer_status", { enum: ["pending", "accepted", "rejected"] })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
  },
  // Retries at the register collapse into one open change order per job.
  (t) => [
    uniqueIndex("change_orders_one_open")
      .on(t.jobId)
      .where(sql`${t.ownerStatus} = 'pending'`),
  ],
);

export const laborEntries = pgTable("labor_entries", {
  id: id(),
  orgId: orgId(),
  jobId: jobId(),
  memberId: uuid("member_id").references(() => members.id),
  minutes: integer("minutes").notNull(),
  costRateCentsPerHour: cents("cost_rate_cents_per_hour").notNull(),
  createdAt: createdAt(),
});

export const manualCosts = pgTable("manual_costs", {
  id: id(),
  orgId: orgId(),
  jobId: jobId(),
  description: text("description").notNull(),
  amountCents: cents("amount_cents").notNull(),
  createdAt: createdAt(),
});

export const invoices = pgTable("invoices", {
  id: id(),
  orgId: orgId(),
  jobId: jobId().unique(),
  pdfBlobKey: text("pdf_blob_key"),
  subtotalCents: cents("subtotal_cents").notNull(),
  taxCents: cents("tax_cents").notNull(),
  totalCents: cents("total_cents").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  marginCents: cents("margin_cents"),
  marginBps: integer("margin_bps"),
  marginStatus: text("margin_status", { enum: ["preliminary", "final"] })
    .notNull()
    .default("preliminary"),
  createdAt: createdAt(),
});

/** Append-only audit trail. Rows are never updated or deleted. */
export const jobEvents = pgTable(
  "job_events",
  {
    id: id(),
    orgId: orgId(),
    jobId: jobId(),
    type: text("type").notNull(),
    fromState: jobStateEnum("from_state"),
    toState: jobStateEnum("to_state"),
    actor: text("actor").notNull(),
    data: jsonb("data"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: createdAt(),
  },
  (t) => [index("job_events_job").on(t.jobId, t.createdAt)],
);
