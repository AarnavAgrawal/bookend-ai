"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const ITEMS = [
  { href: "/dashboard", label: "Overview", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { href: "/jobs", label: "Jobs", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/prices", label: "Prices", icon: "M12 3v18M7 7h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8" },
  { href: "/outbox", label: "Messages", icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
  { href: "/settings", label: "Settings", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3" },
] as const;

export function Wordmark() {
  return (
    <Link href="/dashboard" className="flex items-center gap-1.5 font-display text-2xl font-bold">
      <span aria-hidden className="h-5 w-1.5 bg-ink" />
      Bookend
      <span aria-hidden className="h-5 w-1.5 bg-amber" />
    </Link>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function Links({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {ITEMS.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 border-l-4 py-2 pr-3 pl-3 text-[15px] ${
                active
                  ? "border-amber bg-white font-semibold text-ink"
                  : "border-transparent text-muted hover:bg-white/70 hover:text-ink"
              }`}
            >
              <Icon path={item.icon} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Account({ orgName, clerk }: { orgName: string; clerk: boolean }) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-3 pt-4">
      {clerk && <UserButton />}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{orgName}</p>
        <p className="text-xs text-muted">Ramp sandbox</p>
      </div>
    </div>
  );
}

export function SideNav({ orgName, clerk }: { orgName: string; clerk: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="sticky top-0 hidden h-screen flex-col justify-between border-r border-line bg-paper py-6 lg:flex">
        <div>
          <div className="mb-8 px-5">
            <Wordmark />
          </div>
          <nav aria-label="Main" className="px-2">
            <Links />
          </nav>
        </div>
        <Account orgName={orgName} clerk={clerk} />
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-paper px-4 py-3 lg:hidden">
        <Wordmark />
        <button
          type="button"
          className="btn btn-quiet min-h-0 px-3 py-1.5 text-sm"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-b border-line bg-paper px-2 pb-4 lg:hidden">
          <Links onNavigate={() => setOpen(false)} />
          <div className="mt-3">
            <Account orgName={orgName} clerk={clerk} />
          </div>
        </nav>
      )}
    </>
  );
}
