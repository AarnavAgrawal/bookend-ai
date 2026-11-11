import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  cancelJobAction,
  draftWithClaudeAction,
  recordAcceptanceAction,
  recordPaymentAction,
  requestCardAction,
  requestRaiseAction,
  sendInvoiceAction,
  sendQuoteAction,
  syncAction,
} from "@/app/actions";
import { PageHeader, StatusBadge, Tabs } from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { ActionMenu } from "@/components/app/job/client";
import {
  CANCELLABLE,
  defaultTab,
  FIELD_STATES,
  tabHref,
  type JobView,
  type TabKey,
} from "@/components/app/job/model";
import { OverviewTab } from "@/components/app/job/overview";
import { JobRail } from "@/components/app/job/rail";
import {
  ActivityTab,
  CardActivityTab,
  ChangeOrdersTab,
  InvoiceTab,
  QuoteTab,
  ReceiptsTab,
} from "@/components/app/job/tabs";
import { SubmitButton } from "@/components/capture";
import {
  changeOrders,
  invoices,
  jobEvents,
  jobs,
  priceObservations,
  quoteLines,
  rampOperations,
  receipts,
} from "@/db/schema";
import { cardLimitForQuote, lineSellCents } from "@/domain/quote";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { invoiceUrl, jobMargin } from "@/services/closeout";
import { jobSpend } from "@/services/field";
import { changeOrderUrl, crewUrl, customerOf, latestQuote, loadOrg, quoteUrl } from "@/services/jobs";

const TAB_KEYS: TabKey[] = ["overview", "quote", "card", "receipts", "changes", "invoice", "activity"];

/** A one-button form, so every action posts to its server action with its bound arguments. */
function ActionButton({
  action,
  children,
  pending,
  variant = "primary",
}: {
  action: () => Promise<void>;
  children: ReactNode;
  pending?: string;
  variant?: "primary" | "secondary" | "menu" | "menu-danger";
}) {
  const className = {
    primary: "ui-btn ui-btn-primary",
    secondary: "ui-btn ui-btn-secondary",
    menu: "ui-btn ui-btn-ghost ui-btn-sm",
    "menu-danger": "ui-btn ui-btn-ghost ui-btn-sm !text-danger hover:!bg-danger-soft",
  }[variant];
  return (
    <form action={action}>
      <SubmitButton className={className} pending={pending}>
        {children}
      </SubmitButton>
    </form>
  );
}

/** The one thing the owner should do next, if anything. */
function PrimaryAction({ view }: { view: JobView }) {
  const { job, quote, claude } = view;
  const draft = claude ? (
    <ActionButton action={draftWithClaudeAction.bind(null, job.id)} pending="Claude is checking your prices…">
      Draft with Claude
    </ActionButton>
  ) : null;
  switch (job.state) {
    case "draft":
      return draft;
    case "quote_review":
      return quote ? (
        <ActionButton action={sendQuoteAction.bind(null, job.id, job.version)} pending="Sending…">
          Send quote
        </ActionButton>
      ) : (
        draft
      );
    case "quote_sent":
      return (
        <ActionButton action={recordAcceptanceAction.bind(null, job.id)} pending="Recording…">
          Record acceptance
        </ActionButton>
      );
    case "accepted":
      return (
        <ActionButton action={requestCardAction.bind(null, job.id)} pending="Preparing the card…">
          Open job card
        </ActionButton>
      );
    case "change_pending":
      return view.openOrder ? (
        <ActionButton action={requestRaiseAction.bind(null, job.id)} pending="Preparing…">
          Review limit raise
        </ActionButton>
      ) : null;
    case "invoice_review":
      return (
        <ActionButton action={sendInvoiceAction.bind(null, job.id)} pending="Sending…">
          Send invoice
        </ActionButton>
      );
    case "invoiced":
      return (
        <ActionButton action={recordPaymentAction.bind(null, job.id)} pending="Checking Ramp…">
          Mark as paid
        </ActionButton>
      );
    default:
      return null;
  }
}

/** Quiet actions that apply in this state: checking Ramp and cancelling. */
function MoreActions({ view }: { view: JobView }) {
  const { job, fund } = view;
  const canSync = job.state === "card_opening" || (fund !== null && fund.state !== "terminated");
  const canCancel = CANCELLABLE.includes(job.state);
  if (!canSync && !canCancel) return null;
  return (
    <ActionMenu>
      {canSync && (
        <ActionButton action={syncAction.bind(null, job.id)} pending="Checking Ramp…" variant="menu">
          Check Ramp now
        </ActionButton>
      )}
      {canCancel && (
        <ActionButton action={cancelJobAction.bind(null, job.id)} pending="Cancelling…" variant="menu-danger">
          Cancel job
        </ActionButton>
      )}
    </ActionMenu>
  );
}

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const deps = await getDeps();
  const { db } = deps;
  const session = await requireSession(db);
  const { id } = await props.params;
  const search = await props.searchParams;
  const error = typeof search.error === "string" ? search.error : undefined;

  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.orgId, session.orgId)));
  if (!job) notFound();

  const org = await loadOrg(db, session.orgId);
  const customer = await customerOf(db, job.customerId);
  const quote = await latestQuote(db, job.id);
  const lines = quote ? await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id)) : [];
  const evidenceIds = [...new Set(lines.flatMap((l) => l.evidenceIds))];
  const evidenceRows =
    evidenceIds.length === 0
      ? []
      : await db
          .select()
          .from(priceObservations)
          .where(and(eq(priceObservations.orgId, session.orgId), inArray(priceObservations.id, evidenceIds)));
  const evidence = Object.fromEntries(
    evidenceRows.map((r) => [
      r.id,
      { id: r.id, item: r.item, unitCostCents: r.unitCostCents, source: r.source, observedAt: r.observedAt.toISOString() },
    ]),
  );
  const { fund, transactions, spend } = await jobSpend(db, job.id);
  const orders = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.jobId, job.id))
    .orderBy(asc(changeOrders.createdAt));
  const jobReceipts = await db
    .select()
    .from(receipts)
    .where(eq(receipts.jobId, job.id))
    .orderBy(desc(receipts.createdAt));
  const [invoice] = await db.select().from(invoices).where(eq(invoices.jobId, job.id));
  const margin = invoice ? await jobMargin(db, job.id, invoice.subtotalCents) : null;
  const events = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, job.id))
    .orderBy(desc(jobEvents.createdAt));
  const [operation] = await db
    .select()
    .from(rampOperations)
    .where(eq(rampOperations.jobId, job.id))
    .orderBy(desc(rampOperations.createdAt))
    .limit(1);

  // The invoice bills the quote plus every change order the customer agreed to.
  const invoiceLines = [
    ...lines.map((l) => ({ description: l.description, amountCents: lineSellCents(l) })),
    ...orders
      .filter((o) => o.ownerStatus === "approved" && o.customerStatus === "accepted")
      .map((o) => ({
        description: `Change order: ${o.reason ?? "additional materials"}`,
        amountCents: o.sellAmountCents ?? 0,
      })),
  ];

  const view: JobView = {
    job,
    org,
    customer,
    quote,
    lines,
    evidence,
    fund,
    transactions,
    spend,
    orders,
    openOrder: orders.find((o) => o.ownerStatus === "pending") ?? null,
    receipts: jobReceipts,
    invoice: invoice ?? null,
    invoiceLines,
    margin,
    events,
    operation: operation ?? null,
    limitPreviewCents: quote ? cardLimitForQuote(quote, org) : null,
    claude: Boolean(deps.claude),
    // The same test the mailer uses: without both, messages are only logged.
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    links: {
      crew: FIELD_STATES.includes(job.state) ? crewUrl(deps, job.id) : null,
      quote: job.state === "quote_sent" && quote ? quoteUrl(deps, quote.id) : null,
      invoice: invoice?.pdfBlobKey ? invoiceUrl(deps, invoice.id) : null,
      changeOrders: Object.fromEntries(
        orders
          .filter((o) => o.ownerStatus === "approved" && o.customerStatus === "pending")
          .map((o) => [o.id, changeOrderUrl(deps, o.id)]),
      ),
    },
  };

  const requested = typeof search.tab === "string" ? (search.tab as TabKey) : null;
  const tab: TabKey = requested && TAB_KEYS.includes(requested) ? requested : defaultTab(job.state);

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: "overview", label: "Overview" },
    { key: "quote", label: "Quote" },
    { key: "card", label: "Card activity", count: transactions.length },
    { key: "receipts", label: "Receipts", count: jobReceipts.length },
    { key: "changes", label: "Change orders", count: orders.length },
    { key: "invoice", label: "Invoice" },
    { key: "activity", label: "Activity" },
  ];

  const content = {
    overview: <OverviewTab view={view} />,
    quote: <QuoteTab view={view} />,
    card: <CardActivityTab view={view} />,
    receipts: <ReceiptsTab view={view} />,
    changes: <ChangeOrdersTab view={view} />,
    invoice: <InvoiceTab view={view} />,
    activity: <ActivityTab view={view} />,
  }[tab];

  const subtitle = [`#${job.jobNumber}`, customer?.name, customer?.address].filter(Boolean).join(", ");

  return (
    <AppShell orgName={org.name}>
      <PageHeader
        crumbs={[{ href: "/jobs", label: "Jobs" }]}
        title={job.title}
        description={subtitle}
        actions={
          <>
            <StatusBadge state={job.state} />
            <MoreActions view={view} />
            <PrimaryAction view={view} />
          </>
        }
      />

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 4.8v3.6M8 11h.01" />
          </svg>
          <p>{error}</p>
        </div>
      )}

      {/* The tab strip overflows by the 1px its underline overlaps, which shows a scrollbar on Windows. */}
      <div className="[&>nav]:[scrollbar-width:none]">
        <Tabs
          tabs={tabs.map((t) => ({
            href: tabHref(job.id, t.key),
            label: t.label,
            count: t.count,
            active: t.key === tab,
          }))}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">{content}</div>
        <aside aria-label="Job summary" className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:col-span-4">
          <JobRail view={view} />
        </aside>
      </div>
    </AppShell>
  );
}
