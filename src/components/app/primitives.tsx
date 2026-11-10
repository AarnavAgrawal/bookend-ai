import Link from "next/link";
import type { ReactNode } from "react";
import type { JobState } from "@/domain/transition";

/** Job states in the owner's words: what is true now, not what to do. */
export const STATUS_LABELS: Record<JobState, string> = {
  draft: "Draft",
  quote_review: "Quote ready",
  quote_sent: "Quote sent",
  accepted: "Accepted",
  card_opening: "Opening card",
  active: "In progress",
  change_pending: "Card declined",
  closing: "Closing",
  invoice_review: "Invoice ready",
  invoiced: "Invoiced",
  settled: "Paid",
  cancelled: "Cancelled",
};

type Tone = "neutral" | "accent" | "info" | "success" | "danger" | "muted";

const STATUS_TONE: Record<JobState, Tone> = {
  draft: "muted",
  quote_review: "accent",
  quote_sent: "neutral",
  accepted: "accent",
  card_opening: "neutral",
  active: "info",
  change_pending: "danger",
  closing: "info",
  invoice_review: "accent",
  invoiced: "neutral",
  settled: "success",
  cancelled: "muted",
};

const TONE_CLASS: Record<Tone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-subtle text-ink", dot: "bg-faint" },
  accent: { pill: "bg-accent-soft text-ink", dot: "bg-accent" },
  info: { pill: "bg-[#E8EEF7] text-[#1F3F6E]", dot: "bg-[#3B6BB0]" },
  success: { pill: "bg-success-soft text-success", dot: "bg-success" },
  danger: { pill: "bg-danger-soft text-danger", dot: "bg-danger" },
  muted: { pill: "bg-subtle text-muted", dot: "bg-faint" },
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const t = TONE_CLASS[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${t.pill}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}

export function StatusBadge({ state }: { state: JobState }) {
  return <Badge tone={STATUS_TONE[state]}>{STATUS_LABELS[state]}</Badge>;
}

export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: Array<{ href: string; label: string }>;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-[13px] text-muted">
          {crumbs.map((crumb, index) => (
            <span key={crumb.href} className="flex items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden className="text-faint">
                  /
                </span>
              )}
              <Link href={crumb.href} className="hover:text-ink">
                {crumb.label}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-balance">{title}</h1>
          {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** No inner padding, for tables and lists that run edge to edge. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-border bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Table({ children, minWidth = "36rem" }: { children: ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border bg-subtle/60">{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2 text-xs font-medium whitespace-nowrap text-muted ${align === "right" ? "text-right" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

/** A row. With `href`, the first cell carries the link and the whole row is clickable. */
export function TR({ children, href }: { children: ReactNode; href?: string }) {
  return (
    <tr className={href ? "group relative cursor-pointer hover:bg-subtle/60" : ""}>
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-2.5 align-middle ${align === "right" ? "text-right tabular-nums" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

/** The link in a clickable row. Its overlay makes the whole row the hit area. */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-ink after:absolute after:inset-0 after:content-['']">
      {children}
    </Link>
  );
}

/** Spend against a budget. Amber, and red only when the card refused something. */
export function Progress({
  value,
  max,
  declined = false,
  label,
}: {
  value: number;
  max: number;
  declined?: boolean;
  label?: string;
}) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label ?? "Spent against the limit"}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-subtle"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${declined ? "bg-danger" : "bg-accent"}`}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export function KeyValue({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-border">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="text-[13px] text-muted">{item.label}</dt>
          <dd className="text-right text-[13px] font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({
  tabs,
}: {
  tabs: Array<{ href: string; label: string; count?: number; active: boolean }>;
}) {
  return (
    <nav aria-label="Sections" className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] whitespace-nowrap ${
            tab.active
              ? "border-ink font-medium text-ink"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="rounded-full bg-subtle px-1.5 text-[11px] tabular-nums text-muted">
              {tab.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-[13px] text-pretty text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}

/** One strip with dividers, not a row of separate boxes. */
export function StatStrip({ children }: { children: ReactNode }) {
  return (
    // A 1px gap over the border colour draws every divider, whatever the column count.
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4 [&>*]:bg-surface">
      {children}
    </div>
  );
}
