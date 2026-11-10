import { dollars, money } from "@/components/ui";

/**
 * Daily card spend for the last 30 days. One series, so no legend: the card
 * title names it. Each bar is a hover target with its own tooltip, and a table
 * holds the same numbers for screen readers.
 */
export function SpendChart({ days }: { days: Array<{ date: string; cents: number }> }) {
  const max = Math.max(...days.map((d) => d.cents), 1);
  // Round the axis up to a tidy number so its label is readable.
  const step = 10 ** Math.max(2, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const total = days.reduce((sum, d) => sum + d.cents, 0);
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{dollars(total)}</p>
      <p className="mb-4 text-xs text-muted">Cleared and pending, last 30 days</p>
      <div className="flex gap-2">
        {/* One line-height taller than the plot and pulled up by half, so each label is centred on its gridline. */}
        <div aria-hidden className="-mt-[6px] flex h-[calc(9rem+12px)] flex-col justify-between text-right text-[11px] leading-[12px] text-faint tabular-nums">
          <span>{dollars(top)}</span>
          <span>{dollars(top / 2)}</span>
          <span>$0</span>
        </div>
        <div className="min-w-0 flex-1">
          {/* Gridlines share the bars' box, so the $0 line sits under the bars, not under the date labels. */}
          <div aria-hidden className="relative flex h-36 items-end gap-[2px]">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              <div className="border-t border-dashed border-border" />
              <div className="border-t border-dashed border-border" />
              <div className="border-t border-border" />
            </div>
            {days.map((d) => (
              <div key={d.date} className="group relative flex h-full flex-1 items-end" title={`${label(d.date)}: ${money(d.cents)}`}>
                <div
                  className={`w-full rounded-t-[3px] ${d.cents > 0 ? "bg-accent group-hover:bg-ink" : ""}`}
                  style={{ height: d.cents > 0 ? `max(${(d.cents / top) * 100}%, 3px)` : 0 }}
                />
              </div>
            ))}
          </div>
          <div aria-hidden className="mt-1.5 flex justify-between text-[11px] text-faint">
            <span>{label(days[0]?.date ?? "")}</span>
            <span>{label(days.at(-1)?.date ?? "")}</span>
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>Card spend by day</caption>
        <tbody>
          {days
            .filter((d) => d.cents > 0)
            .map((d) => (
              <tr key={d.date}>
                <th scope="row">{label(d.date)}</th>
                <td>{money(d.cents)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
