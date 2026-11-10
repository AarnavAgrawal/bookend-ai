import Link from "next/link";
import type { ReactNode } from "react";
import { rejectChangeAction, requestRaiseAction } from "@/app/actions";
import { Badge, Card, EmptyState } from "@/components/app/primitives";
import { SubmitButton } from "@/components/capture";
import { eventLabel, money, percent } from "@/components/ui";
import type { JobState } from "@/domain/transition";
import { CopyField } from "./client";
import { formatDate, formatDateTime, tabHref, type JobView, type Tone } from "./model";

const STEPS = ["Quote", "Customer", "Card", "In progress", "Invoice", "Paid"] as const;

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
  settled: 6,
  cancelled: -1,
};

/** Where the job is in its life: six segments, done in ink, the current one in amber. */
export function Lifecycle({ state }: { state: JobState }) {
  const current = STEP_OF[state];
  if (current < 0) return null;
  const label = current >= STEPS.length ? "Every step done" : `${STEPS[current]}, step ${current + 1} of ${STEPS.length}`;
  return (
    <>
      <p className="mb-2 text-xs text-muted sm:hidden">
        {label}
      </p>
      <ol className="grid grid-cols-6 gap-1.5" aria-label="Job progress">
        {STEPS.map((step, index) => {
          const done = index < current;
          const here = index === current;
          const bar = done ? "bg-ink" : here ? (state === "change_pending" ? "bg-danger" : "bg-accent") : "bg-subtle";
          return (
            <li key={step} aria-current={here ? "step" : undefined} className="min-w-0">
              <span aria-hidden className={`block h-1 rounded-full ${bar}`} />
              <span
                className={`mt-2 hidden items-start gap-1 text-xs leading-tight sm:flex ${here ? "font-medium text-ink" : done ? "text-ink" : "text-faint"}`}
              >
                {done && (
                  <svg aria-hidden viewBox="0 0 12 12" className="mt-px h-3 w-3 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.2l2.3 2.3 4.7-5" />
                  </svg>
                )}
                {step}
                {done && <span className="sr-only">, done</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

type NextStep = { who: string; tone: Tone; text: ReactNode; extra?: ReactNode };

function nextStep(view: JobView): NextStep {
  const { job, customer, links, operation, spend, fund } = view;
  const name = customer?.name ?? "The customer";
  // Messages only leave the app when email is set up and the customer has an address.
  const unsent = !view.email
    ? "Email isn't set up, so nothing was emailed"
    : !customer?.email
      ? `There's no email address for ${name}, so nothing was emailed`
      : null;
  switch (job.state) {
    case "draft":
      return {
        who: "Your move",
        tone: "accent",
        text: view.claude
          ? "Write the quote: let Claude draft it from your price history, or add the lines yourself."
          : "Write the quote: add the materials and labor on the Quote tab, then save it.",
      };
    case "quote_review":
      return { who: "Your move", tone: "accent", text: `Check the quote, then send it to ${name}. They accept it from a link.` };
    case "quote_sent":
      return {
        who: "Waiting on customer",
        tone: "neutral",
        text: unsent
          ? `${unsent}. Send ${name} the quote link below. Once they accept, you open the job card. If they agreed by phone, record it.`
          : `${name} has the quote. Once they accept, you open the job card. If they agreed by phone, record it.`,
        extra: links.quote && <CopyField label="Customer's quote page" url={links.quote} />,
      };
    case "accepted":
      return {
        who: "Your move",
        tone: "accent",
        text: `${name} accepted. Open a job card limited to ${view.limitPreviewCents === null ? "the quoted materials" : money(view.limitPreviewCents)} so the crew can buy materials.`,
      };
    case "card_opening":
      return operation?.status === "failed"
        ? {
            who: "Your move",
            tone: "danger",
            text: `Ramp rejected this card: ${String((operation.response as { error?: string } | null)?.error ?? "no reason given")}.`,
          }
        : { who: "Bookend is working", tone: "info", text: "Bookend is finishing the card with Ramp. Check again in a moment." };
    case "active":
      return {
        who: "Crew is working",
        tone: "info",
        text: spend.nearLimit
          ? `The crew is on site and has used most of the card: ${money(spend.remainingCents)} is left.`
          : "The crew is on site, buying on the job card. They finish the job from the crew link.",
      };
    case "change_pending":
      return {
        who: "Your move",
        tone: "danger",
        text: "The card declined a purchase. Raise the limit so the crew can retry, or keep the limit as it is.",
      };
    case "closing":
      return {
        who: "Bookend is working",
        tone: "info",
        text: "The crew finished. Bookend is waiting for the last card charges, then drafts the invoice.",
      };
    case "invoice_review":
      return { who: "Your move", tone: "accent", text: `Check the invoice and the margin, then send it to ${name}.` };
    case "invoiced":
      return {
        who: "Waiting on customer",
        tone: "neutral",
        text: `${unsent ? `${unsent}. Send ${name} the invoice PDF from the Links panel.` : `The invoice is with ${name}.`} Mark it paid when the money arrives${fund ? "; Bookend checks the card once more and the margin becomes final" : ""}.`,
      };
    case "settled":
      return {
        who: "Done",
        tone: "success",
        text:
          view.invoice?.paidAt && view.margin
            ? `Paid ${formatDate(view.invoice.paidAt)}. The card is closed and the true margin is ${money(view.margin.marginCents)} (${percent(view.margin.marginBps)}).`
            : "Paid. The card is closed and the margin is final.",
      };
    case "cancelled":
      return {
        who: "Cancelled",
        tone: "muted",
        text: fund ? "This job was cancelled and its card is frozen." : "This job was cancelled before a card was opened.",
      };
  }
}

/** The card declined something: what, why, and the limit that would let the crew retry. */
export function DeclinedAlert({ view }: { view: JobView }) {
  const order = view.openOrder;
  if (!order) return null;
  const figures = [
    { label: "Declined", value: money(order.declinedCents), strong: true },
    { label: "Current limit", value: view.fund ? money(view.fund.limitCents) : "None" },
    { label: "New limit", value: money(order.requestedLimitCents) },
  ];
  return (
    <section role="alert" className="min-w-0 overflow-hidden rounded-lg border border-danger/40 bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/20 bg-danger-soft px-4 py-2.5">
        <h2 className="text-sm font-semibold text-danger">The card declined a {money(order.declinedCents)} purchase</h2>
        <span className="text-xs text-danger/80 tabular-nums">{formatDateTime(order.createdAt)}</span>
      </header>
      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs text-muted">The crew&apos;s reason</p>
          <p className="mt-1 text-[13px] text-pretty">
            {order.reason ?? <span className="text-muted">The crew hasn&apos;t explained it yet. They can from the crew link.</span>}
          </p>
          {order.evidenceBlobKey && (
            <a
              className="mt-1.5 inline-block text-[13px] font-medium underline underline-offset-2"
              href={`/api/files/${order.id}`}
              target="_blank"
              rel="noreferrer"
            >
              View the crew&apos;s photo
            </a>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
          {figures.map((f) => (
            <div key={f.label} className="bg-surface px-3 py-2">
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className={`mt-0.5 text-sm tabular-nums ${f.strong ? "font-semibold text-danger" : "font-medium"}`}>{f.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          Raising the limit lets the crew retry straight away. The customer is asked to agree the extra cost separately.
        </p>
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border bg-subtle/40 px-4 py-3">
        <form action={rejectChangeAction.bind(null, view.job.id)}>
          <SubmitButton className="ui-btn ui-btn-danger ui-btn-sm" pending="Keeping…">
            Keep the limit
          </SubmitButton>
        </form>
        <form action={requestRaiseAction.bind(null, view.job.id)}>
          <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Preparing…">
            Review limit raise
          </SubmitButton>
        </form>
      </footer>
    </section>
  );
}

export function RecentActivity({ view, limit = 5 }: { view: JobView; limit?: number }) {
  return (
    <Card
      flush
      title="Recent activity"
      actions={
        view.events.length > limit && (
          <Link href={tabHref(view.job.id, "activity")} className="ui-btn ui-btn-ghost ui-btn-sm">
            View all
          </Link>
        )
      }
    >
      {view.events.length === 0 ? (
        <EmptyState title="No activity yet" description="Quotes, approvals and card events will be listed here." />
      ) : (
        <ul className="divide-y divide-border">
          {view.events.slice(0, limit).map((event) => (
            <li key={event.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <p className="min-w-0 text-[13px]">
                <span className="font-medium">{eventLabel(event.type)}</span>
                <span className="text-muted"> by {event.actor}</span>
              </p>
              <time className="shrink-0 text-xs text-faint tabular-nums" dateTime={event.createdAt.toISOString()}>
                {formatDateTime(event.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OverviewTab({ view }: { view: JobView }) {
  const step = nextStep(view);
  return (
    <div className="space-y-4">
      <DeclinedAlert view={view} />

      <Card title={view.job.state === "settled" || view.job.state === "cancelled" ? "Outcome" : "Next step"} actions={<Badge tone={step.tone}>{step.who}</Badge>}>
        <p className="text-sm text-pretty">{step.text}</p>
        {step.extra && <div className="mt-4 max-w-lg">{step.extra}</div>}
        {view.job.state !== "cancelled" && (
          <div className="mt-5 border-t border-border pt-4">
            <Lifecycle state={view.job.state} />
          </div>
        )}
      </Card>

      {view.job.description && (
        <Card title="Scope of work">
          <p className="max-w-prose text-[13px] whitespace-pre-line text-pretty">{view.job.description}</p>
        </Card>
      )}

      <RecentActivity view={view} />
    </div>
  );
}
