import Link from "next/link";
import type { ReactNode } from "react";
import type { JobState } from "@/domain/transition";
import { SideNav } from "./side-nav";

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whole dollars, for tiles and charts where cents are noise. */
export const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export const percent = (bps: number | null) => (bps === null ? "n/a" : `${(bps / 100).toFixed(1)}%`);

export const STATE_LABELS: Record<JobState, string> = {
  draft: "Needs a quote",
  quote_review: "Review the quote",
  quote_sent: "Waiting for the customer",
  accepted: "Accepted: open the card",
  card_opening: "Opening the card",
  active: "On site",
  change_pending: "Card declined: decide",
  closing: "Closing",
  invoice_review: "Review the invoice",
  invoiced: "Waiting for payment",
  settled: "Paid",
  cancelled: "Cancelled",
};

/** What happened, in the past tense, for history and activity feeds. */
export const EVENT_LABELS: Record<string, string> = {
  QUOTE_DRAFTED: "Quote drafted",
  QUOTE_REVISION_REQUESTED: "Quote reopened",
  OWNER_APPROVED_QUOTE: "Quote sent to the customer",
  CUSTOMER_ACCEPTED: "Customer accepted the quote",
  CARD_OPEN_STARTED: "Card approved",
  CARD_VERIFIED: "Card opened",
  OVERRUN_DETECTED: "Card declined a purchase",
  CHANGE_RESOLVED: "Change order decided",
  CREW_DONE: "Crew finished the job",
  INVOICE_DRAFTED: "Invoice drafted",
  INVOICE_SENT: "Invoice sent",
  SETTLED: "Paid",
  CANCELLED: "Cancelled",
  QUOTE_AGENT_RUN: "Claude drafted the quote",
  RECEIPT_READ: "Claude read a receipt",
  VOICE_NOTE_READ: "Claude read the crew note",
  CHANGE_ORDER_DRAFT: "Claude drafted the change order",
};

export const eventLabel = (type: string) =>
  EVENT_LABELS[type] ?? type.toLowerCase().replaceAll("_", " ");

type Tone = "alert" | "action" | "live" | "waiting" | "done";

const TONE: Record<JobState, Tone> = {
  change_pending: "alert",
  draft: "action",
  quote_review: "action",
  accepted: "action",
  card_opening: "action",
  invoice_review: "action",
  active: "live",
  closing: "live",
  quote_sent: "waiting",
  invoiced: "waiting",
  settled: "done",
  cancelled: "done",
};

const TONE_CLASS: Record<Tone, string> = {
  alert: "border-red bg-red/10 text-redtext",
  action: "border-amber bg-amber/15 text-ink",
  live: "border-ink bg-ink text-paper",
  waiting: "border-line bg-white text-muted",
  done: "border-line bg-transparent text-muted",
};

/** A job's state, with its label carrying the meaning so color is never alone. */
export function StatusPill({ state }: { state: JobState }) {
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_CLASS[TONE[state]]}`}
    >
      {STATE_LABELS[state]}
    </span>
  );
}

/**
 * The one signature element: a bar held between two bookends, filling as money
 * is spent. The left end is the quote and the right end is the limit.
 */
export function Rail({
  committedCents,
  limitCents,
  height = "h-5",
  declined = false,
}: {
  committedCents: number;
  limitCents: number;
  height?: string;
  /** Red means the card refused something. Spending right up to the limit is fine. */
  declined?: boolean;
}) {
  const ratio = limitCents > 0 ? Math.min(committedCents / limitCents, 1) : 0;
  return (
    <div
      role="meter"
      aria-label="Spent against the card limit"
      aria-valuemin={0}
      aria-valuemax={limitCents}
      aria-valuenow={Math.min(committedCents, limitCents)}
      aria-valuetext={`${money(committedCents)} of ${money(limitCents)}`}
      className={`flex items-stretch ${height}`}
    >
      <div className="w-2 bg-ink" />
      <div className="flex-1 bg-line">
        <div
          className={`h-full transition-[width] duration-500 motion-reduce:transition-none ${declined ? "bg-red" : "bg-amber"}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className={`w-2 ${declined ? "bg-red" : "bg-ink"}`} />
    </div>
  );
}

/**
 * A bullet bar: amber for what was spent, an ink tick for what was quoted, on a
 * scale that fits whichever is larger. Values are printed beside it, because
 * amber alone is too light to read against white.
 */
export function BudgetBar({ spentCents, quotedCents }: { spentCents: number; quotedCents: number }) {
  const scale = Math.max(spentCents, quotedCents, 1);
  return (
    <div
      className="relative h-3 bg-line"
      title={`${money(spentCents)} spent of ${money(quotedCents)} quoted`}
      role="img"
      aria-label={`${money(spentCents)} spent of ${money(quotedCents)} quoted`}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-r-[4px] bg-amber"
        style={{ width: `${(spentCents / scale) * 100}%` }}
      />
      <div
        className="absolute -inset-y-1 w-0.5 bg-ink"
        style={{ left: `calc(${(quotedCents / scale) * 100}% - 1px)` }}
      />
    </div>
  );
}

export function ErrorNote({ message }: { message?: string | string[] }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-5 border-l-4 border-red bg-white px-4 py-3 text-redtext">
      {message}
    </p>
  );
}

export function Shell({ children, orgName }: { children: ReactNode; orgName: string }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <SideNav orgName={orgName} clerk={Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)} />
      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-20 sm:px-8 lg:pt-10">{children}</main>
    </div>
  );
}

/** Breadcrumbs, a title and the page's actions, the same way on every page. */
export function PageHeader({
  title,
  crumbs = [],
  meta,
  actions,
}: {
  title: ReactNode;
  crumbs?: Array<{ href: string; label: string }>;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
          {crumbs.map((crumb) => (
            <span key={crumb.href}>
              <Link href={crumb.href} className="hover:text-ink hover:underline">
                {crumb.label}
              </Link>
              <span aria-hidden className="mx-2">
                /
              </span>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl">{title}</h1>
          {meta && <div className="mt-1 text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A headline number with its label. Never a chart: one number doesn't need one. */
export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-line bg-white px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="money mt-1 text-4xl leading-none">{value}</p>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </div>
  );
}

/** For customers and crew: their page, with the business's name and nothing else. */
export function PublicShell({ children, orgName }: { children: ReactNode; orgName: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 pb-16">
      <header className="flex items-center gap-1.5 py-5 font-display text-xl font-bold">
        <span aria-hidden className="h-4 w-1 bg-ink" />
        {orgName}
      </header>
      <main>{children}</main>
    </div>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-2xl">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Row({
  label,
  value,
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-6 py-1 ${strong ? "text-xl" : ""}`}>
      <span className={strong ? "font-display font-semibold" : "text-muted"}>{label}</span>
      <span className="money">{value}</span>
    </div>
  );
}

export function NotFoundNote({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-3xl">{title}</h1>
      <p className="mt-2 text-muted">{detail}</p>
    </div>
  );
}
