import { Suspense, type ReactNode } from "react";
import { Flash } from "./flash";
import { Sidebar, Topbar } from "./nav";

/** The owner's app frame: sidebar, top bar, and a centred content column. */
export function AppShell({
  orgName,
  children,
  wide = false,
}: {
  orgName: string;
  children: ReactNode;
  /** Use the full width, for dense tables. */
  wide?: boolean;
}) {
  return (
    <div className="app flex min-h-screen text-ink">
      <Sidebar orgName={orgName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar orgName={orgName} clerk={Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)} />
        <main className={`mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${wide ? "max-w-[90rem]" : "max-w-7xl"}`}>
          {children}
        </main>
        <Suspense>
          <Flash />
        </Suspense>
      </div>
    </div>
  );
}
