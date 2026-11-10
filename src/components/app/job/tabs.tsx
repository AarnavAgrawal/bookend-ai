import type { ReactNode } from "react";
import {
  draftWithClaudeAction,
  enterReceiptAction,
  ownerCustomerResponseAction,
  recordPaymentAction,
  saveQuoteAction,
  sendInvoiceAction,
  syncAction,
} from "@/app/actions";
import { Badge, Card, EmptyState, STATUS_LABELS, Table, TBody, TD, TH, THead, TR } from "@/components/app/primitives";
import { SubmitButton } from "@/components/capture";
import { QuoteEditor, type EditorLine, type EditorRates } from "@/components/quote-editor";
import { eventLabel, money, percent } from "@/components/ui";
import { lineSellCents } from "@/domain/quote";
import { CopyField } from "./client";
import {
  changeOrderStatus,
  formatDate,
  formatDateTime,
  receiptStatus,
  transactionStatus,
  type JobView,
} from "./model";
import { DeclinedAlert } from "./overview";

const KIND_LABEL = { material: "Material", labor: "Labor", other: "Other" } as const;

/** A totals row under a table: label on the left, figure under the amount column. */
function TotalRow({ label, value, span, strong }: { label: string; value: ReactNode; span: number; strong?: boolean }) {
  return (
    <tr className={strong ? "border-t border-border" : ""}>
      <td colSpan={span} className={`px-4 pt-2 text-right ${strong ? "pb-3 font-semibold" : "text-muted"}`}>
        {label}
      </td>
      <td className={`px-4 pt-2 text-right tabular-nums ${strong ? "pb-3 font-semibold" : ""}`}>{value}</td>
    </tr>
  );
}

/* Quote ------------------------------------------------------------------ */

export function QuoteTab({ view }: { view: JobView }) {
  const { job, quote, lines, org } = view;
  const editing = job.state === "draft" || job.state === "quote_review";

  if (editing) {
    const editorLines: EditorLine[] = lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitCostCents: l.unitCostCents,
      evidenceIds: l.evidenceIds,
      isEstimate: l.isEstimate,
    }));
    const rates: EditorRates = {
      markupBps: org.markupBps,
      laborCostCentsPerHour: org.laborCostCentsPerHour,
      laborBillCentsPerHour: org.laborBillCentsPerHour,
      taxRateBps: org.taxRateBps,
      cardBufferCents: org.cardBufferCents,
    };
    return (
      <Card
        flush
        title={quote ? `Quote, version ${quote.version}` : "New quote"}
        description={
          quote
            ? `Saved ${formatDateTime(quote.createdAt)}${quote.draftedBy === "agent" ? ", drafted by Claude" : ""}`
            : "Add materials and labor. Totals update as you type."
        }
        actions={
          view.claude &&
          quote && (
            <form action={draftWithClaudeAction.bind(null, job.id)}>
              <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Claude is checking your prices…">
                Redraft with Claude
              </SubmitButton>
            </form>
          )
        }
      >
        {!view.claude && (
          <p className="border-b border-border bg-subtle/40 px-4 py-2 text-xs text-muted">
            Enter the lines by hand. Once Claude is connected in Settings, it can draft quotes from your price book.
          </p>
        )}
        <QuoteEditor
          key={quote?.id ?? "new"}
          action={saveQuoteAction.bind(null, job.id)}
          initialLines={editorLines}
          assumptions={quote?.assumptions ?? ""}
          rates={rates}
        />
      </Card>
    );
  }

  if (!quote) {
    return (
      <Card>
        <EmptyState title="No quote" description="This job never had a quote saved." />
      </Card>
    );
  }

  const accepted = quote.acceptedAt
    ? `Accepted ${formatDate(quote.acceptedAt)}${quote.acceptedVia === "owner_recorded" ? ", recorded by you" : " from the customer's link"}`
    : `Sent ${formatDate(quote.createdAt)}`;

  return (
    <Card flush title={`Quote, version ${quote.version}`} description={accepted}>
      <Table minWidth="0">
        <THead>
          <TH>Description</TH>
          <TH className="hidden sm:table-cell">Type</TH>
          <TH align="right">Qty</TH>
          <TH align="right" className="hidden sm:table-cell">
            Unit price
          </TH>
          <TH align="right">Amount</TH>
        </THead>
        <TBody>
          {lines.map((line) => {
            const labor = line.kind === "labor";
            return (
              <TR key={line.id}>
                <TD>{line.description}</TD>
                <TD className="hidden text-muted sm:table-cell">{KIND_LABEL[line.kind]}</TD>
                <TD align="right">{labor ? `${line.quantity / 60} h` : line.quantity}</TD>
                <TD align="right" className="hidden sm:table-cell">
                  {money(line.unitSellCents)}
                  {labor && <span className="text-muted">/h</span>}
                </TD>
                <TD align="right">{money(lineSellCents(line))}</TD>
              </TR>
            );
          })}
        </TBody>
        <tfoot className="border-t border-border text-[13px]">
          <TotalRow span={4} label="Subtotal" value={money(quote.subtotalSellCents)} />
          <TotalRow span={4} label="Tax" value={money(quote.taxCents)} />
          <TotalRow span={4} label="Total" value={money(quote.totalCents)} strong />
        </tfoot>
      </Table>
      {quote.assumptions && (
        <p className="border-t border-border px-4 py-3 text-[13px] text-muted">
          <span className="font-medium text-ink">Assumptions. </span>
          {quote.assumptions}
        </p>
      )}
    </Card>
  );
}

/* Card activity ---------------------------------------------------------- */

const when = (t: JobView["transactions"][number]) => t.occurredAt ?? t.updatedAt;

/** Ramp's decline codes, in the owner's words. Unknown codes fall back to a readable version of the code. */
const DECLINE_REASONS: Record<string, string> = {
  AUTHORIZER_CARD_LIMIT: "Over the card's limit",
  AUTHORIZER_MEMBER_LIMIT: "Over the spending limit",
  AUTHORIZER_USER_LIMIT: "Over the spending limit",
  AUTHORIZER_SUSPENDED_CARD: "The card was frozen",
};

const declineReason = (code: string) => DECLINE_REASONS[code] ?? code.toLowerCase().replaceAll("_", " ");

export function CardActivityTab({ view }: { view: JobView }) {
  const { fund, spend, job } = view;
  const rows = [...view.transactions].sort((a, b) => when(b).getTime() - when(a).getTime());
  const canSync = fund !== null && fund.state !== "terminated";
  const sync = canSync && (
    <form action={syncAction.bind(null, job.id)}>
      <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Checking Ramp…">
        Check Ramp now
      </SubmitButton>
    </form>
  );

  return (
    <Card
      flush
      title="Card activity"
      description={fund ? `Every charge on this job's Ramp card, newest first` : "This job has no card yet"}
      actions={sync}
    >
      {rows.length === 0 ? (
        <EmptyState
          title="No charges yet"
          description={
            fund
              ? "Purchases on the job card appear here as Ramp reports them."
              : "Once the customer accepts and the card opens, its purchases appear here."
          }
        />
      ) : (
        <Table minWidth="0">
          <THead>
            <TH>Merchant</TH>
            <TH className="hidden sm:table-cell">Date</TH>
            <TH>Status</TH>
            <TH align="right">Amount</TH>
          </THead>
          <TBody>
            {rows.map((t) => {
              const status = transactionStatus(t.state);
              const declined = t.state === "DECLINED";
              return (
                <TR key={t.id}>
                  <TD>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{t.merchantName ?? "Unknown merchant"}</span>
                      {t.source === "simulated" && (
                        <span
                          className="rounded border border-border px-1 text-[11px] leading-4 text-muted"
                          title="A simulated purchase from the crew page, not a real card swipe"
                        >
                          Test
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted sm:hidden">{formatDateTime(when(t))}</span>
                    {declined && t.declineReason && (
                      <span className="block text-xs text-danger first-letter:uppercase">{declineReason(t.declineReason)}</span>
                    )}
                  </TD>
                  <TD className="hidden whitespace-nowrap text-muted tabular-nums sm:table-cell">{formatDateTime(when(t))}</TD>
                  <TD>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </TD>
                  <TD align="right" className={declined ? "text-faint line-through" : ""}>
                    {money(t.amountCents)}
                  </TD>
                </TR>
              );
            })}
          </TBody>
          <tfoot className="border-t border-border text-[13px]">
            <tr>
              <td colSpan={4} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-xs text-muted">
                    {spend.pendingCents > 0
                      ? `Includes ${money(spend.pendingCents)} still pending`
                      : "Declined charges don't count"}
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="mr-3 font-medium">Spent</span>
                    <span className="font-semibold tabular-nums">{money(spend.committedCents)}</span>
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </Table>
      )}
    </Card>
  );
}

/* Receipts --------------------------------------------------------------- */

export function ReceiptsTab({ view }: { view: JobView }) {
  const { job } = view;
  return (
    <Card flush title="Receipts" description="Photos the crew took, matched to card charges by amount">
      {view.receipts.length === 0 ? (
        <EmptyState
          title="No receipts yet"
          description={
            view.claude
              ? "When the crew photographs a receipt from the crew link, Claude reads it and matches it to a charge here."
              : "When the crew photographs a receipt from the crew link, it shows here for you to match to a charge."
          }
        />
      ) : (
        <Table minWidth="0">
          <THead>
            <TH>Receipt</TH>
            <TH className="hidden sm:table-cell">Uploaded</TH>
            <TH>Status</TH>
            <TH align="right">Total</TH>
          </THead>
          <TBody>
            {view.receipts.map((r) => {
              const status = receiptStatus(r.matchStatus);
              const unmatched = r.matchStatus !== "matched";
              return [
                <tr key={r.id} className={unmatched ? "border-b-0" : ""}>
                  <TD>
                    <a
                      className="font-medium underline-offset-2 hover:underline"
                      href={`/api/files/${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.merchantName ?? "Receipt photo"}
                    </a>
                    <span className="block text-xs text-muted sm:hidden">{formatDateTime(r.createdAt)}</span>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-muted tabular-nums sm:table-cell">{formatDateTime(r.createdAt)}</TD>
                  <TD>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </TD>
                  <TD align="right">{r.totalCents === null ? <span className="text-faint">Unread</span> : money(r.totalCents)}</TD>
                </tr>,
                unmatched && (
                  <tr key={`${r.id}-entry`}>
                    <td colSpan={4} className="px-4 pb-3">
                      <details className="group rounded-md border border-border bg-subtle/40">
                        <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                          <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">
                            ›
                          </span>
                          Enter the merchant and total by hand to match it
                        </summary>
                        <form
                          action={enterReceiptAction.bind(null, job.id, r.id)}
                          className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
                        >
                          <label className="block">
                            Merchant
                            <input name="merchant" required defaultValue={r.merchantName ?? ""} className="mt-1 h-8 py-1 text-[13px]" />
                          </label>
                          <label className="block">
                            Total ($)
                            <input
                              name="total"
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              required
                              defaultValue={r.totalCents === null ? undefined : r.totalCents / 100}
                              className="mt-1 h-8 py-1 text-right text-[13px] tabular-nums"
                            />
                          </label>
                          <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Saving…">
                            Save and match
                          </SubmitButton>
                        </form>
                      </details>
                    </td>
                  </tr>
                ),
              ];
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

/* Change orders ---------------------------------------------------------- */

export function ChangeOrdersTab({ view }: { view: JobView }) {
  const { job, orders, links } = view;
  return (
    <div className="space-y-4">
      <DeclinedAlert view={view} />
      <Card flush title="Change orders" description="Declined purchases, your decision on each, and the customer's answer">
        {orders.length === 0 ? (
          <EmptyState
            title="No change orders"
            description="If the card declines a purchase, the crew explains it and it appears here for you to decide."
          />
        ) : (
          <Table minWidth="0">
            <THead>
              <TH>Change</TH>
              <TH align="right" className="hidden sm:table-cell">
                Declined
              </TH>
              <TH align="right" className="hidden sm:table-cell">
                New limit
              </TH>
              <TH align="right">Customer price</TH>
              <TH className="hidden sm:table-cell">Status</TH>
            </THead>
            <TBody>
              {orders.map((o) => {
                const status = changeOrderStatus(o);
                const awaitingCustomer = o.ownerStatus === "approved" && o.customerStatus === "pending";
                return [
                  <tr key={o.id} className={awaitingCustomer ? "border-b-0" : ""}>
                    <TD>
                      <span className="line-clamp-2 font-medium">{o.reason ?? "Extra materials"}</span>
                      <span className="block text-xs text-muted">
                        {formatDate(o.createdAt)}
                        <span className="sm:hidden">, {money(o.declinedCents)} declined</span>
                      </span>
                      <span className="mt-1.5 block sm:hidden">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </span>
                    </TD>
                    <TD align="right" className="hidden sm:table-cell">
                      {money(o.declinedCents)}
                    </TD>
                    <TD align="right" className="hidden sm:table-cell">
                      {money(o.requestedLimitCents)}
                    </TD>
                    <TD align="right">
                      {o.sellAmountCents === null ? <span className="text-faint">Not set</span> : money(o.sellAmountCents)}
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </TD>
                  </tr>,
                  awaitingCustomer && (
                    <tr key={`${o.id}-customer`}>
                      <td colSpan={5} className="px-4 pb-3">
                        <div className="grid gap-3 rounded-md border border-border bg-subtle/40 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
                          {links.changeOrders[o.id] && (
                            <CopyField label="Customer's change order page" url={links.changeOrders[o.id]} />
                          )}
                          <div className="flex flex-wrap gap-2">
                            <form action={ownerCustomerResponseAction.bind(null, job.id, o.id, true)}>
                              <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm">They agreed by phone</SubmitButton>
                            </form>
                            <form action={ownerCustomerResponseAction.bind(null, job.id, o.id, false)}>
                              <SubmitButton className="ui-btn ui-btn-ghost ui-btn-sm">They said no</SubmitButton>
                            </form>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/* Invoice ---------------------------------------------------------------- */

function MarginBreakdown({ view }: { view: JobView }) {
  const { invoice, margin } = view;
  if (!invoice || !margin) return null;
  const final = invoice.marginStatus === "final";
  const billed = invoice.subtotalCents;
  const parts = [
    { label: "Materials on the card", cents: margin.materialsCents, color: "bg-ink" },
    { label: "Labor cost", cents: margin.laborCents, color: "bg-muted" },
    { label: "Other costs", cents: margin.manualCostsCents, color: "bg-faint" },
    { label: final ? "True margin" : "Margin so far", cents: Math.max(0, margin.marginCents), color: "bg-success" },
  ];
  const scale = Math.max(billed, margin.materialsCents + margin.laborCents + margin.manualCostsCents, 1);
  const positive = margin.marginCents >= 0;

  return (
    <Card
      title={final ? "True margin" : "Margin so far"}
      description={final ? "Final: every card charge has landed" : "Charges can still land on the frozen card until it is paid"}
      actions={
        <span className={`text-sm font-semibold tabular-nums ${positive ? "text-success" : "text-danger"}`}>
          {percent(margin.marginBps)}
        </span>
      }
    >
      <div
        className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-subtle"
        role="img"
        aria-label={`Of ${money(billed)} billed: ${parts.map((p) => `${p.label} ${money(p.cents)}`).join(", ")}`}
      >
        {parts.map((p) =>
          p.cents > 0 ? <span key={p.label} className={p.color} style={{ width: `${(p.cents / scale) * 100}%` }} /> : null,
        )}
      </div>
      <dl className="mt-4 divide-y divide-border text-[13px]">
        <div className="flex justify-between gap-4 pb-2">
          <dt className="text-muted">Billed before tax</dt>
          <dd className="font-medium tabular-nums">{money(billed)}</dd>
        </div>
        {parts.slice(0, 3).map((p) => (
          <div key={p.label} className="flex justify-between gap-4 py-2">
            <dt className="flex items-center gap-2 text-muted">
              <span aria-hidden className={`h-2 w-2 rounded-sm ${p.color}`} />
              {p.label}
            </dt>
            <dd className="tabular-nums">{money(p.cents)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 pt-2 font-semibold">
          <dt className="flex items-center gap-2">
            <span aria-hidden className={`h-2 w-2 rounded-sm ${positive ? "bg-success" : "bg-danger"}`} />
            {final ? "True margin" : "Margin so far"}
          </dt>
          <dd className={`tabular-nums ${positive ? "text-success" : "text-danger"}`}>
            {money(margin.marginCents)} ({percent(margin.marginBps)})
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export function InvoiceTab({ view }: { view: JobView }) {
  const { invoice, job, links } = view;
  if (!invoice) {
    return (
      <Card title="Invoice">
        <EmptyState
          title="No invoice yet"
          description="When the crew finishes, Bookend drafts the invoice from the quote and any change orders the customer agreed to."
        />
      </Card>
    );
  }

  const status = invoice.paidAt
    ? { label: `Paid ${formatDate(invoice.paidAt)}`, tone: "success" as const }
    : invoice.sentAt
      ? { label: `Sent ${formatDate(invoice.sentAt)}`, tone: "neutral" as const }
      : { label: "Draft", tone: "accent" as const };

  const action =
    job.state === "invoice_review" ? (
      <form action={sendInvoiceAction.bind(null, job.id)}>
        <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Sending…">
          Send invoice
        </SubmitButton>
      </form>
    ) : job.state === "invoiced" ? (
      <form action={recordPaymentAction.bind(null, job.id)}>
        <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Checking Ramp…">
          Mark as paid
        </SubmitButton>
      </form>
    ) : null;

  return (
    <div className="space-y-4">
      <Card
        flush
        title={`Invoice for job #${job.jobNumber}`}
        description={`Drafted ${formatDate(invoice.createdAt)}`}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      >
        <Table minWidth="0">
          <THead>
            <TH>Description</TH>
            <TH align="right">Amount</TH>
          </THead>
          <TBody>
            {view.invoiceLines.map((line, i) => (
              <TR key={i}>
                <TD>{line.description}</TD>
                <TD align="right">{money(line.amountCents)}</TD>
              </TR>
            ))}
          </TBody>
          <tfoot className="border-t border-border text-[13px]">
            <TotalRow span={1} label="Subtotal" value={money(invoice.subtotalCents)} />
            <TotalRow span={1} label="Tax" value={money(invoice.taxCents)} />
            <TotalRow span={1} label="Total due" value={money(invoice.totalCents)} strong />
          </tfoot>
        </Table>
        {(links.invoice || action) && (
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border bg-subtle/40 px-4 py-3">
            <div className="w-full max-w-sm">
              {links.invoice ? (
                <CopyField label="Invoice PDF" url={links.invoice} />
              ) : (
                <p className="text-xs text-muted">The PDF is made when you send the invoice.</p>
              )}
            </div>
            {action}
          </div>
        )}
      </Card>
      <MarginBreakdown view={view} />
    </div>
  );
}

/* Activity --------------------------------------------------------------- */

export function ActivityTab({ view }: { view: JobView }) {
  return (
    <Card flush title="Activity" description="Everything that happened on this job, newest first">
      {view.events.length === 0 ? (
        <EmptyState title="No activity yet" description="Quotes, approvals and card events will be listed here." />
      ) : (
        <Table minWidth="0">
          <THead>
            <TH>Event</TH>
            <TH className="hidden sm:table-cell">By</TH>
            <TH align="right">When</TH>
          </THead>
          <TBody>
            {view.events.map((e) => (
              <TR key={e.id}>
                <TD>
                  <span className="font-medium">{eventLabel(e.type)}</span>
                  {e.toState && e.toState !== e.fromState && (
                    <span className="block text-xs text-muted">Status: {STATUS_LABELS[e.toState]}</span>
                  )}
                  <span className="block text-xs text-muted sm:hidden">by {e.actor}</span>
                </TD>
                <TD className="hidden text-muted sm:table-cell">{e.actor}</TD>
                <TD align="right" className="whitespace-nowrap text-muted">
                  <time dateTime={e.createdAt.toISOString()}>{formatDateTime(e.createdAt)}</time>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
