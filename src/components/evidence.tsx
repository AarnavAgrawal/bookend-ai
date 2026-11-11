import type { priceObservations } from "@/db/schema";
import { medianCents } from "@/domain/quote";
import { money } from "./ui";

export type PriceSource = (typeof priceObservations.$inferSelect)["source"];

/** What the owner calls each place a price came from. */
export const SOURCE_LABELS: Record<PriceSource, string> = {
  ramp_receipt: "Receipt",
  ramp_merchant_data: "Ramp",
  price_book: "Price book",
  csv: "Imported",
  closed_job: "Past job",
};

/** One past price a quote line cites. Dates are ISO strings so this can cross into client components. */
export type EvidenceRecord = {
  id: string;
  item: string;
  unitCostCents: number;
  source: PriceSource;
  observedAt: string;
};

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The prices behind a quote line, so the owner can see why it costs what it
 * does. Closed by default: one quiet line until they want the detail.
 */
export function EvidenceList({ ids, records }: { ids: string[]; records: Record<string, EvidenceRecord> }) {
  const found = ids
    .map((id) => records[id])
    .filter((r): r is EvidenceRecord => Boolean(r))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const count = ids.length;
  const median = medianCents(found.map((r) => r.unitCostCents));
  const summary = `Median of ${count} past ${count === 1 ? "price" : "prices"}`;
  if (found.length === 0) return <p className="mt-1 text-xs text-muted">{summary}</p>;

  return (
    <details className="group mt-1 max-w-md">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-3 w-3 transition-transform duration-150 group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        {summary}
      </summary>
      <div className="mt-1.5 overflow-hidden rounded-md border border-border bg-surface">
        <ul className="divide-y divide-border">
          {found.map((record) => (
            <li key={record.id} className="flex items-baseline gap-3 px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate" title={record.item}>
                {record.item}
              </span>
              <span className="shrink-0 text-muted">{SOURCE_LABELS[record.source]}</span>
              <time className="w-[5.5rem] shrink-0 text-right text-muted tabular-nums" dateTime={record.observedAt}>
                {shortDate.format(new Date(record.observedAt))}
              </time>
              <span className="w-16 shrink-0 text-right font-medium tabular-nums">{money(record.unitCostCents)}</span>
            </li>
          ))}
        </ul>
        {median !== null && (
          <p className="flex justify-between border-t border-border bg-subtle/60 px-2.5 py-1.5 text-xs">
            <span className="text-muted">Unit cost used, the median</span>
            <span className="font-semibold tabular-nums">{money(median)}</span>
          </p>
        )}
      </div>
    </details>
  );
}
