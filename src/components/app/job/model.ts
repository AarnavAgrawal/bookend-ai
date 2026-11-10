import type {
  changeOrders,
  customers,
  invoices,
  jobEvents,
  jobFunds,
  jobs,
  orgs,
  quoteLines,
  quotes,
  rampOperations,
  receipts,
  transactions,
} from "@/db/schema";
import type { SpendSummary } from "@/domain/money";
import type { JobState } from "@/domain/transition";
import type { jobMargin } from "@/services/closeout";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

/** Everything the job page shows, loaded once by the page and passed to each section. */
export type JobView = {
  job: Row<typeof jobs>;
  org: Row<typeof orgs>;
  customer: Row<typeof customers> | null;
  quote: Row<typeof quotes> | null;
  lines: Array<Row<typeof quoteLines>>;
  fund: Row<typeof jobFunds> | null;
  transactions: Array<Row<typeof transactions>>;
  spend: SpendSummary;
  orders: Array<Row<typeof changeOrders>>;
  openOrder: Row<typeof changeOrders> | null;
  receipts: Array<Row<typeof receipts>>;
  invoice: Row<typeof invoices> | null;
  invoiceLines: Array<{ description: string; amountCents: number }>;
  margin: Awaited<ReturnType<typeof jobMargin>> | null;
  events: Array<Row<typeof jobEvents>>;
  operation: Row<typeof rampOperations> | null;
  limitPreviewCents: number | null;
  claude: boolean;
  /** Whether quotes and invoices actually go out by email, as opposed to waiting on the Messages page. */
  email: boolean;
  links: {
    crew: string | null;
    quote: string | null;
    invoice: string | null;
    changeOrders: Record<string, string>;
  };
};

export type TabKey = "overview" | "quote" | "card" | "receipts" | "changes" | "invoice" | "activity";

export const FIELD_STATES: JobState[] = ["active", "change_pending", "closing"];

export const CANCELLABLE: JobState[] = [
  "draft",
  "quote_review",
  "quote_sent",
  "accepted",
  "card_opening",
  "active",
  "change_pending",
];

/** The tab that matters for where the job is now. */
export function defaultTab(state: JobState): TabKey {
  if (state === "draft" || state === "quote_review") return "quote";
  if (state === "change_pending") return "changes";
  if (state === "invoice_review" || state === "invoiced") return "invoice";
  return "overview";
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export const formatDateTime = (at: Date) => dateTime.format(at);
export const formatDate = (at: Date) => dateOnly.format(at);

export type Tone = "neutral" | "accent" | "info" | "success" | "danger" | "muted";

export function transactionStatus(state: Row<typeof transactions>["state"]): { label: string; tone: Tone } {
  if (state === "CLEARED" || state === "COMPLETION") return { label: "Cleared", tone: "success" };
  if (state === "DECLINED") return { label: "Declined", tone: "danger" };
  if (state === "ERROR") return { label: "Error", tone: "danger" };
  return { label: "Pending", tone: "neutral" };
}

export function changeOrderStatus(order: Row<typeof changeOrders>): { label: string; tone: Tone } {
  if (order.ownerStatus === "pending") return { label: "Needs your decision", tone: "danger" };
  if (order.ownerStatus === "rejected") return { label: "Limit kept", tone: "muted" };
  if (order.customerStatus === "pending") return { label: "Waiting on customer", tone: "accent" };
  if (order.customerStatus === "accepted") return { label: "Customer agreed", tone: "success" };
  return { label: "Customer declined", tone: "muted" };
}

export function receiptStatus(status: Row<typeof receipts>["matchStatus"]): { label: string; tone: Tone } {
  if (status === "matched") return { label: "Matched", tone: "success" };
  if (status === "needs_review") return { label: "Needs review", tone: "accent" };
  return { label: "Not matched", tone: "neutral" };
}

export const tabHref = (jobId: string, tab: TabKey) => `/jobs/${jobId}?tab=${tab}`;
