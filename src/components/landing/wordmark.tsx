/** "Bookend" held between its two ends: ink for the quote, amber for the outcome. */
export function Wordmark({ size = "text-2xl", tone = "ink" }: { size?: string; tone?: "ink" | "paper" }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-bold leading-none ${size}`}>
      <span aria-hidden="true" className={`h-[0.9em] w-[0.22em] ${tone === "paper" ? "bg-paper" : "bg-ink"}`} />
      <span className="-translate-y-px">Bookend</span>
      <span aria-hidden="true" className="h-[0.9em] w-[0.22em] bg-amber" />
    </span>
  );
}
