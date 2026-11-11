"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

type Item = { href: string; label: string; icon: ReactNode };

const svg = (d: string) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const MAIN: Item[] = [
  { href: "/dashboard", label: "Overview", icon: svg("M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z") },
  { href: "/ask", label: "Ask Bookend", icon: svg("M4 5h16v11H9l-5 4zM8 9h8M8 12h5") },
  { href: "/jobs", label: "Jobs", icon: svg("M4 7h16v13H4zM9 7V4h6v3") },
  { href: "/cards", label: "Cards", icon: svg("M3 6h18v12H3zM3 10h18M7 15h3") },
  { href: "/customers", label: "Customers", icon: svg("M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z") },
  { href: "/prices", label: "Price book", icon: svg("M20 12l-8 8-9-9V3h8zM7.5 7.5h.01") },
  { href: "/outbox", label: "Messages", icon: svg("M4 5h16v14H4zM4 6l8 7 8-7") },
];

const SETTINGS: Item = {
  href: "/settings",
  label: "Settings",
  icon: svg("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"),
};

export function Wordmark() {
  return (
    <Link href="/dashboard" className="flex items-center gap-1.5 font-display text-[22px] leading-none font-bold">
      <span aria-hidden className="h-4 w-1 bg-ink" />
      Bookend
      <span aria-hidden className="h-4 w-1 bg-accent" />
    </Link>
  );
}

function NavLink({ item, onNavigate }: { item: Item; onNavigate?: () => void }) {
  const path = usePathname();
  const active = path === item.href || path.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors ${
        active ? "bg-subtle font-medium text-ink" : "text-muted hover:bg-subtle/70 hover:text-ink"
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {MAIN.map((item) => (
        <li key={item.href}>
          <NavLink item={item} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ orgName }: { orgName: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-58 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Wordmark />
      </div>
      <div className="px-3 pt-3">
        <p className="truncate px-2.5 pb-2 text-xs text-muted">{orgName}</p>
        <nav aria-label="Main">
          <NavList />
        </nav>
      </div>
      <div className="mt-auto border-t border-border p-3">
        <NavLink item={SETTINGS} />
        <p className="mt-2 px-2.5 text-[11px] text-faint">Ramp sandbox. No real money moves.</p>
      </div>
    </aside>
  );
}

export function Topbar({ clerk, orgName }: { clerk: boolean; orgName: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-sm -ml-2 lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {svg(open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16")}
        </button>
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <form action="/jobs" role="search" className="ml-auto hidden w-full max-w-sm sm:block lg:ml-0">
          <label htmlFor="global-search" className="sr-only">
            Search jobs
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
              {svg("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3")}
            </span>
            <input id="global-search" name="q" placeholder="Search jobs and customers" className="!h-8 !py-0 !pl-8 !text-[13px]" />
          </div>
        </form>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/jobs/new" className="ui-btn ui-btn-primary ui-btn-sm">
            {svg("M12 5v14M5 12h14")}
            New job
          </Link>
          {clerk && <UserButton />}
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-b border-border bg-surface px-3 pt-2 pb-3 lg:hidden">
          <p className="truncate px-2.5 pb-2 text-xs text-muted">{orgName}</p>
          <NavList onNavigate={close} />
          <div className="mt-2 border-t border-border pt-2">
            <NavLink item={SETTINGS} onNavigate={close} />
          </div>
        </nav>
      )}
    </>
  );
}
