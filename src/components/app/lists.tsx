import Link from "next/link";
import type { ReactNode } from "react";

/** "5m ago" for recent moments, a short date after a week. */
export function ago(at: Date, now: Date) {
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : shortDate(at, now);
}

/** "Nov 3", or "Nov 3, 2025" outside the current year. */
export function shortDate(at: Date, now = new Date()) {
  return at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

const searchIcon = (
  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
    <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3" />
  </svg>
);

/** A GET search box for a card header. Other filters ride along as hidden fields. */
export function SearchBox({
  action,
  value,
  placeholder,
  label,
  keep = {},
}: {
  action: string;
  value: string;
  placeholder: string;
  label: string;
  keep?: Record<string, string>;
}) {
  return (
    <form action={action} role="search" className="w-full sm:w-72">
      {Object.entries(keep).map(([name, v]) => (
        <input key={name} type="hidden" name={name} value={v} />
      ))}
      <label htmlFor={`${action.replace(/\W/g, "")}-search`} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">{searchIcon}</span>
        <input
          id={`${action.replace(/\W/g, "")}-search`}
          type="search"
          name="q"
          defaultValue={value}
          placeholder={placeholder}
          className="!h-8 !py-0 !pl-8 !text-[13px]"
        />
      </div>
    </form>
  );
}

/** The phone layout of a table: one stacked row per item. Pair with a table hidden below 640px. */
export function MobileList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border sm:hidden">{children}</ul>;
}

export function MobileRow({
  href,
  title,
  subtitle,
  aside,
  meta,
  scroll,
}: {
  href: string;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  meta?: ReactNode;
  scroll?: boolean;
}) {
  return (
    <li>
      <Link href={href} scroll={scroll} className="block px-4 py-3 active:bg-subtle">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {aside && <div className="shrink-0 text-right text-[13px] font-medium tabular-nums">{aside}</div>}
        </div>
        {meta && <div className="mt-2">{meta}</div>}
      </Link>
    </li>
  );
}

/** Table on wide screens, stacked rows on phones. */
export function DesktopOnly({ children }: { children: ReactNode }) {
  return <div className="hidden sm:block">{children}</div>;
}
