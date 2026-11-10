"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Confirms that an action worked. Actions redirect with `?notice=`; this shows
 * it once, then removes it from the address so a refresh doesn't repeat it.
 */
export function Flash() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const notice = params.get("notice");
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const rest = new URLSearchParams(params.toString());
    rest.delete("notice");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    const show = window.setTimeout(() => setShown(notice), 0);
    const hide = window.setTimeout(() => setShown(null), 6000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [notice, params, pathname, router]);

  if (!shown) return null;
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-ink px-4 py-3 text-[13px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] motion-safe:animate-[flash-in_160ms_ease-out]"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-[#7BD39A]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
      <p className="text-pretty">{shown}</p>
      <button
        type="button"
        onClick={() => setShown(null)}
        className="-my-1 -mr-2 ml-1 rounded px-2 py-1 text-white/70 hover:text-white"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
