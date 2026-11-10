import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  cancelJobAction,
  draftWithClaudeAction,
  enterReceiptAction,
  ownerCustomerResponseAction,
  recordAcceptanceAction,
  recordPaymentAction,
  rejectChangeAction,
  requestCardAction,
  requestRaiseAction,
  saveQuoteAction,
  sendInvoiceAction,
  sendQuoteAction,
  syncAction,
} from "@/app/actions";
import { CopyLink, SubmitButton } from "@/components/capture";
import { QuoteEditor, type EditorLine } from "@/components/quote-editor";
import {
  ErrorNote,
  eventLabel,
  money,
  percent,
  Rail,
  Row,
  Section,
  Shell,
  PageHeader,
  StatusPill,
} from "@/components/ui";
import {
  changeOrders,
  invoices,
  jobEvents,
  jobs,
  quoteLines,
  rampOperations,
  receipts,
} from "@/db/schema";
import { cardLimitForQuote, lineSellCents } from "@/domain/quote";
import type { JobState } from "@/domain/transition";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { invoiceUrl, jobMargin } from "@/services/closeout";
import { jobSpend } from "@/services/field";
import { changeOrderUrl, crewUrl, customerOf, latestQuote, loadOrg, quoteUrl } from "@/services/jobs";

const FIELD_STATES: JobState[] = ["active", "change_pending", "closing"];
const SPENDING_STATES: JobState[] = [
  "active",
  "change_pending",
  "closing",
  "invoice_review",
  "invoiced",
  "settled",
];
const CANCELLABLE: JobState[] = [
  "draft",
  "quote_review",
  "quote_sent",
  "accepted",
  "card_opening",
  "active",
  "change_pending",
];

const STEPS = ["Quote", "Customer", "Card", "On site", "Invoice", "Paid"] as const;

const STEP_OF: Record<JobState, number> = {
  draft: 0,
  quote_review: 0,
  quote_sent: 1,
  accepted: 2,
  card_opening: 2,
  active: 3,
  change_pending: 3,
  closing: 3,
  invoice_review: 4,
  invoiced: 4,
  settled: 5,
  cancelled: -1,
};

/** Where the job is in its life. These really are steps in order, so they're numbered. */
function JobStepper({ state }: { state: JobState }) {
  const current = STEP_OF[state];
  if (current < 0) return null;
  return (
    <ol className="mb-8 grid grid-cols-3 gap-y-2 border-y border-line py-3 text-sm sm:grid-cols-6">
      {STEPS.map((step, index) => {
        const done = index < current || state === "settled";
        const here = index === current && state !== "settled";
        return (
          <li
            key={step}
            aria-current={here ? "step" : undefined}
            className={`flex items-center gap-2 ${here ? "font-semibold text-ink" : done ? "text-ink" : "text-muted"}`}
          >
            <span
              aria-hidden
              className={`money flex h-6 w-6 shrink-0 items-center justify-center text-xs ${
                here
                  ? state === "change_pending"
                    ? "bg-red text-white"
                    : "bg-amber text-ink"
                  : done
                    ? "bg-ink text-paper"
                    : "border border-line bg-white"
              }`}
            >
              {done ? "✓" : index + 1}
            </span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const deps = await getDeps();
  const { db } = deps;
  const session = await requireSession(db);
  const { id } = await props.params;
  const { error } = await props.searchParams;

  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.orgId, session.orgId)));
  if (!job) notFound();

  const org = await loadOrg(db, session.orgId);
  const customer = await customerOf(db, job.customerId);
  const quote = await latestQuote(db, job.id);
  const lines = quote
    ? await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id))
    : [];
  const { fund, transactions, spend } = await jobSpend(db, job.id);
  const orders = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.jobId, job.id))
    .orderBy(asc(changeOrders.createdAt));
  const openOrder = orders.find((o) => o.ownerStatus === "pending");
  const jobReceipts = await db.select().from(receipts).where(eq(receipts.jobId, job.id));
  const [invoice] = await db.select().from(invoices).where(eq(invoices.jobId, job.id));
  const margin = invoice ? await jobMargin(db, job.id, invoice.subtotalCents) : null;
  const events = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, job.id))
    .orderBy(desc(jobEvents.createdAt))
    .limit(12);
  const [operation] = await db
    .select()
    .from(rampOperations)
    .where(eq(rampOperations.jobId, job.id))
    .orderBy(desc(rampOperations.createdAt))
    .limit(1);

  const editing = job.state === "draft" || job.state === "quote_review";
  const editorLines: EditorLine[] = lines.map((l) => ({
    kind: l.kind,
    description: l.description,
    quantity: l.quantity,
    unitCostCents: l.unitCostCents,
    evidenceIds: l.evidenceIds,
    isEstimate: l.isEstimate,
  }));
  const limitPreview = quote ? cardLimitForQuote(quote, org) : null;

  return (
    <Shell orgName={org.name}>
      <ErrorNote message={error} />

      <PageHeader
        crumbs={[{ href: "/jobs", label: "Jobs" }]}
        title={job.title}
        meta={
          <>
            <span className="money">Job {job.jobNumber}</span>
            {customer?.name ? `, ${customer.name}` : ""}
            {customer?.address ? `, ${customer.address}` : ""}
          </>
        }
        actions={<StatusPill state={job.state} />}
      />
      <JobStepper state={job.state} />

      {fund && SPENDING_STATES.includes(job.state) && (
        <div className="mt-6">
          <Rail
            committedCents={spend.committedCents}
            limitCents={fund.limitCents}
            declined={job.state === "change_pending"}
          />
          <div className="mt-2 flex justify-between gap-4">
            <span className="money text-xl">{money(spend.committedCents)} spent</span>
            <span className="money text-xl">{money(fund.limitCents)} limit</span>
          </div>
          {job.nearLimitWarnedAt && job.state === "active" && (
            <p className="mt-1 text-sm text-muted">This job is close to its limit.</p>
          )}
        </div>
      )}

      {openOrder && (
        <div className="ticket ticket-alert mt-8">
          <h2 className="text-2xl">The card declined a {money(openOrder.declinedCents)} purchase</h2>
          <p className="mt-2">{openOrder.reason ?? "The crew hasn't said why yet."}</p>
          {openOrder.evidenceBlobKey && (
            <a className="underline" href={`/api/files/${openOrder.id}`} target="_blank" rel="noreferrer">
              See the crew&apos;s photo
            </a>
          )}
          <p className="mt-3">
            Raising the limit to <span className="money">{money(openOrder.requestedLimitCents)}</span>{" "}
            lets the crew retry straight away. The customer is asked to agree the cost separately.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <form action={requestRaiseAction.bind(null, job.id)}>
              <SubmitButton className="btn btn-amber">Review the raise</SubmitButton>
            </form>
            <form action={rejectChangeAction.bind(null, job.id)}>
              <SubmitButton className="btn btn-danger">Keep the limit</SubmitButton>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <Section title={quote ? `Quote, version ${quote.version}` : "Quote"}>
          {deps.claude ? (
            <form action={draftWithClaudeAction.bind(null, job.id)} className="mb-5">
              <SubmitButton className="btn btn-amber" pending="Claude is checking your prices…">
                {quote ? "Redraft from price history" : "Draft from price history"}
              </SubmitButton>
            </form>
          ) : (
            <p className="mb-4 text-muted">
              Add your Anthropic key to have this drafted from your price history. For now, enter
              the lines by hand.
            </p>
          )}
          <QuoteEditor
            key={quote?.id ?? "new"}
            action={saveQuoteAction.bind(null, job.id)}
            initialLines={editorLines}
            assumptions={quote?.assumptions ?? ""}
          />
        </Section>
      )}

      {quote && (
        <Section title={editing ? "What the customer sees" : "Quote"}>
          <div className="ticket">
            {lines.map((line) => (
              <Row key={line.id} label={line.description} value={money(lineSellCents(line))} />
            ))}
            <div className="mt-2 border-t border-line pt-2">
              <Row label="Subtotal" value={money(quote.subtotalSellCents)} />
              <Row label="Tax" value={money(quote.taxCents)} />
              <Row label="Total" value={money(quote.totalCents)} strong />
            </div>
          </div>
          {limitPreview !== null && !fund && (
            <p className="mt-2 text-sm text-muted">
              The card for this job would be limited to {money(limitPreview)}: materials, tax and
              your buffer.
            </p>
          )}
          {quote.assumptions && !editing && (
            <p className="mt-2 text-sm text-muted">Assumed: {quote.assumptions}</p>
          )}
          {job.state === "quote_review" && (
            <form action={sendQuoteAction.bind(null, job.id, job.version)} className="mt-4">
              <SubmitButton className="btn btn-amber">Send to {customer?.name}</SubmitButton>
            </form>
          )}
        </Section>
      )}

      {job.state === "quote_sent" && quote && (
        <Section title="Waiting for the customer">
          <CopyLink url={quoteUrl(deps, quote.id)} label="Customer's quote page" />
          <form action={recordAcceptanceAction.bind(null, job.id)} className="mt-3">
            <SubmitButton className="btn btn-quiet">They agreed by phone</SubmitButton>
          </form>
        </Section>
      )}

      {job.state === "accepted" && (
        <Section title="Open the job card">
          <p className="mb-3">
            {customer?.name} accepted. Opening the card creates a Ramp card limited to{" "}
            <span className="money">{limitPreview === null ? "" : money(limitPreview)}</span>.
          </p>
          <form action={requestCardAction.bind(null, job.id)}>
            <SubmitButton className="btn btn-amber">Review the card</SubmitButton>
          </form>
        </Section>
      )}

      {job.state === "card_opening" && (
        <Section title="Opening the card">
          {operation?.status === "failed" ? (
            <p className="text-redtext">
              Ramp rejected this card: {String((operation.response as { error?: string })?.error)}
            </p>
          ) : (
            <form action={syncAction.bind(null, job.id)}>
              <p className="mb-3">Bookend is finishing this with Ramp.</p>
              <SubmitButton className="btn btn-quiet">Check again</SubmitButton>
            </form>
          )}
        </Section>
      )}

      {FIELD_STATES.includes(job.state) && (
        <Section title="Crew">
          <CopyLink url={crewUrl(deps, job.id)} label="Crew page" />
          <p className="mt-1 text-sm text-muted">
            Send this to whoever is on the job. It stops working once the job closes.
          </p>
        </Section>
      )}

      {transactions.length > 0 && (
        <Section title="Card activity">
          <ul className="border-t-2 border-ink">
            {transactions.map((t) => (
              <li key={t.id} className="flex justify-between gap-4 border-b border-line py-2">
                <span>
                  {t.merchantName ?? "Unknown merchant"}
                  {t.state === "DECLINED" && <span className="text-redtext"> declined</span>}
                  {t.state.startsWith("PENDING") && <span className="text-muted"> pending</span>}
                  {t.source === "simulated" && (
                    <span className="text-muted"> (simulated test purchase)</span>
                  )}
                </span>
                <span className="money">{money(t.amountCents)}</span>
              </li>
            ))}
          </ul>
          {fund && fund.state !== "terminated" && (
            <form action={syncAction.bind(null, job.id)} className="mt-3">
              <SubmitButton className="btn btn-quiet" pending="Checking Ramp…">
                Check Ramp now
              </SubmitButton>
            </form>
          )}
        </Section>
      )}

      {jobReceipts.length > 0 && (
        <Section title="Receipts">
          <ul className="space-y-3">
            {jobReceipts.map((r) => (
              <li key={r.id} className="border-b border-line pb-3">
                <a className="underline" href={`/api/files/${r.id}`} target="_blank" rel="noreferrer">
                  {r.merchantName ?? "Receipt photo"}
                </a>
                {r.totalCents !== null && <span className="money"> {money(r.totalCents)}</span>}
                <span className="text-sm text-muted">
                  {r.matchStatus === "matched" ? " matched to a card charge" : " not matched yet"}
                </span>
                {r.matchStatus !== "matched" && (
                  <form
                    action={enterReceiptAction.bind(null, job.id, r.id)}
                    className="mt-2 flex flex-wrap items-end gap-2"
                  >
                    <label className="w-48">
                      Merchant
                      <input name="merchant" required defaultValue={r.merchantName ?? ""} />
                    </label>
                    <label className="w-32">
                      Total ($)
                      <input name="total" type="number" step="0.01" min="0" required />
                    </label>
                    <SubmitButton className="btn btn-quiet">Save</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {orders.some((o) => o.ownerStatus === "approved") && (
        <Section title="Change orders">
          <ul className="space-y-3">
            {orders
              .filter((o) => o.ownerStatus === "approved")
              .map((o) => (
                <li key={o.id} className="border-b border-line pb-3">
                  <Row label={o.reason ?? "Extra materials"} value={money(o.sellAmountCents ?? 0)} />
                  {o.customerStatus === "pending" ? (
                    <div className="mt-1 space-y-2">
                      <CopyLink url={changeOrderUrl(deps, o.id)} label="Customer's change page" />
                      <div className="flex flex-wrap gap-2">
                        <form action={ownerCustomerResponseAction.bind(null, job.id, o.id, true)}>
                          <SubmitButton className="btn btn-quiet">They agreed by phone</SubmitButton>
                        </form>
                        <form action={ownerCustomerResponseAction.bind(null, job.id, o.id, false)}>
                          <SubmitButton className="btn btn-quiet">They said no</SubmitButton>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      {o.customerStatus === "accepted"
                        ? "Customer agreed. It goes on the invoice."
                        : "Customer declined. It won't be billed."}
                    </p>
                  )}
                </li>
              ))}
          </ul>
        </Section>
      )}

      {invoice && margin && (
        <Section title="Invoice and margin">
          <div className="ticket">
            <Row label="Billed before tax" value={money(invoice.subtotalCents)} />
            <Row label="Materials on the card" value={money(margin.materialsCents)} />
            <Row label="Labor" value={money(margin.laborCents)} />
            <Row label="Other costs" value={money(margin.manualCostsCents)} />
            <div className="mt-2 border-t border-line pt-2">
              <Row
                label={invoice.marginStatus === "final" ? "True margin" : "Margin so far"}
                value={`${money(margin.marginCents)} (${percent(margin.marginBps)})`}
                strong
              />
            </div>
            {invoice.marginStatus === "preliminary" && (
              <p className="mt-2 text-sm text-muted">
                Charges can still land after the card is frozen, so this becomes final when the job
                is paid.
              </p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {job.state === "invoice_review" && (
              <form action={sendInvoiceAction.bind(null, job.id)}>
                <SubmitButton className="btn btn-amber">Send invoice</SubmitButton>
              </form>
            )}
            {job.state === "invoiced" && (
              <form action={recordPaymentAction.bind(null, job.id)}>
                <SubmitButton className="btn btn-amber" pending="Checking Ramp…">
                  Mark as paid
                </SubmitButton>
              </form>
            )}
            {invoice.pdfBlobKey && <CopyLink url={invoiceUrl(deps, invoice.id)} label="Invoice PDF" />}
          </div>
        </Section>
      )}

      {events.length > 0 && (
        <Section title="History">
          <ol className="text-sm text-muted">
            {events.map((e) => (
              <li key={e.id} className="flex justify-between gap-4 py-0.5">
                <span>
                  {eventLabel(e.type)} ({e.actor})
                </span>
                <time>{e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</time>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {CANCELLABLE.includes(job.state) && (
        <form action={cancelJobAction.bind(null, job.id)} className="mt-10">
          <SubmitButton className="btn btn-danger">Cancel this job</SubmitButton>
        </form>
      )}
    </Shell>
  );
}
