import Link from "next/link";
import type { ReactNode } from "react";
import type { JobState } from "@/domain/transition";

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

export function ErrorNote({ message }: { message?: string | string[] }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-5 border-l-4 border-red bg-white px-4 py-3 text-redtext">
      {message}
    </p>
  );
}

const NAV = [
  ["/", "Jobs"],
  ["/prices", "Prices"],
  ["/outbox", "Messages"],
  ["/settings", "Settings"],
] as const;

export function Shell({ children, orgName }: { children: ReactNode; orgName: string }) {
  return (
    <div className="mx-auto max-w-5xl px-5 pb-20">
      <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-line py-5">
        <Link href="/" className="font-display text-2xl font-bold">
          {orgName}
        </Link>
        <nav className="flex gap-5 text-sm">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="hover:underline">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="pt-8">{children}</main>
    </div>
  );
}

/** For customers and crew: their page, with the business's name and nothing else. */
export function PublicShell({ children, orgName }: { children: ReactNode; orgName: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 pb-16">
      <header className="py-5 font-display text-xl font-bold">{orgName}</header>
      <main>{children}</main>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-2xl">{title}</h2>
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
