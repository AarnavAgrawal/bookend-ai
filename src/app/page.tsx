import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Shell, STATE_LABELS, money } from "@/components/ui";
import { customers, jobs, quotes, rampConnections } from "@/db/schema";
import type { JobState } from "@/domain/transition";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

const GROUPS: Array<{ title: string; states: JobState[] }> = [
  {
    title: "Needs you",
    states: ["change_pending", "quote_review", "accepted", "invoice_review", "draft", "card_opening"],
  },
  { title: "On site", states: ["active", "closing"] },
  { title: "Waiting on the customer", states: ["quote_sent", "invoiced"] },
  { title: "Finished", states: ["settled", "cancelled"] },
];

export default async function JobsPage() {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const rows = await db
    .select({ job: jobs, customerName: customers.name })
    .from(jobs)
    .leftJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.orgId, session.orgId))
    .orderBy(desc(jobs.updatedAt));
  const allQuotes = await db
    .select({ jobId: quotes.jobId, version: quotes.version, totalCents: quotes.totalCents })
    .from(quotes)
    .where(eq(quotes.orgId, session.orgId));
  const [connection] = await db
    .select({ id: rampConnections.id })
    .from(rampConnections)
    .where(eq(rampConnections.orgId, session.orgId));

  const totals = new Map<string, { version: number; totalCents: number }>();
  for (const quote of allQuotes) {
    const current = totals.get(quote.jobId);
    if (!current || quote.version > current.version) totals.set(quote.jobId, quote);
  }

  return (
    <Shell orgName={org.name}>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl">Jobs</h1>
        <Link href="/jobs/new" className="btn btn-amber">
          Add a job
        </Link>
      </div>

      {!connection && (
        <p className="ticket mb-8">
          Connect Ramp in <Link href="/settings" className="underline">Settings</Link> so jobs can
          get their own card.
        </p>
      )}

      {rows.length === 0 && (
        <div className="ticket">
          <h2 className="text-2xl">Add your first job</h2>
          <p className="mt-1 text-muted">
            Describe the work, and Bookend drafts the quote from what you&apos;ve actually paid.
          </p>
        </div>
      )}

      {GROUPS.map(({ title, states }) => {
        const inGroup = rows.filter((r) => states.includes(r.job.state));
        if (inGroup.length === 0) return null;
        return (
          <section key={title} className="mb-10">
            <h2 className="mb-2 text-2xl">{title}</h2>
            <ul className="border-t-2 border-ink">
              {inGroup.map(({ job, customerName }) => {
                const total = totals.get(job.id)?.totalCents;
                return (
                  <li key={job.id} className="border-b border-line">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-x-4 py-3 hover:bg-white sm:grid-cols-[3.5rem_1fr_14rem_7rem]"
                    >
                      <span className="money text-muted">{job.jobNumber}</span>
                      <span>
                        <span className="font-medium">{job.title}</span>
                        <span className="block text-sm text-muted">{customerName}</span>
                      </span>
                      <span
                        className={`col-start-2 row-start-2 text-sm sm:col-start-auto sm:row-start-auto ${job.state === "change_pending" ? "font-semibold text-redtext" : ""}`}
                      >
                        {STATE_LABELS[job.state]}
                      </span>
                      <span className="money text-right text-lg">
                        {total === undefined ? "" : money(total)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Shell>
  );
}
