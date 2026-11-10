"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A shareable link: what it is, the address itself, and a copy button. */
export function CopyField({ label, url, hint }: { label: string; url: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium">{label}</p>
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-ink hover:underline">
          Open
        </a>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <p
          className="h-8 min-w-0 flex-1 truncate rounded-md border border-border bg-subtle/50 px-2.5 text-xs leading-8 text-muted"
          title={url}
        >
          {url.replace(/^https?:\/\//, "")}
        </p>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-sm shrink-0"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A quiet "More" button whose popover holds the page's secondary actions. */
export function ActionMenu({ label = "More", children }: { label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.contains(event.target as Node)) {
        menu.open = false;
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary className="ui-btn ui-btn-secondary list-none [&::-webkit-details-marker]:hidden">
        {label}
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(20,20,20,0.08)] [&_button]:w-full [&_button]:justify-start">
        {children}
      </div>
    </details>
  );
}
