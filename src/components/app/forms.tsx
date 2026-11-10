import type { InputHTMLAttributes, ReactNode } from "react";

/** A failed action's message, carried back in `?error=`. */
export function FormError({ message }: { message?: string | string[] }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-[13px] text-danger"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <path d="M12 8v5M12 16.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
      </svg>
      <p>{message}</p>
    </div>
  );
}

/** A label above its input, with optional helper text below. */
export function Field({
  label,
  htmlFor,
  help,
  optional = false,
  className = "",
  children,
}: {
  label: string;
  htmlFor: string;
  help?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
        {optional && <span className="ml-1 font-normal text-faint">Optional</span>}
      </label>
      {children}
      {help && <p className="mt-1.5 text-xs text-muted">{help}</p>}
    </div>
  );
}

/** An input with a unit inside it, such as "$" before or "%" after. */
export function UnitInput({
  unit,
  side = "start",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { unit: string; side?: "start" | "end" }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[13px] text-faint ${side === "start" ? "left-2.5" : "right-2.5"}`}
      >
        {unit}
      </span>
      <input {...props} className={`tabular-nums ${side === "start" ? "!pl-6" : "!pr-8"} ${props.className ?? ""}`} />
    </div>
  );
}

/**
 * A titled block of fields inside a form card. On wide screens the title sits
 * in a left column, like Stripe's settings; on narrow ones it stacks above.
 */
export function FormSection({
  title,
  description,
  stacked = false,
  children,
}: {
  title: string;
  description?: string;
  /** Always put the title above the fields, for narrow cards. */
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`grid gap-x-8 gap-y-4 px-4 py-5 sm:px-5 ${stacked ? "" : "lg:grid-cols-[13rem_minmax(0,1fr)]"}`}
    >
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-pretty text-muted">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** The bottom row of a form card: a note on the left, buttons on the right. */
export function FormFooter({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-b-lg border-t border-border bg-subtle/50 px-4 py-3 sm:px-5">
      {note && <p className="mr-auto text-xs text-muted">{note}</p>}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
