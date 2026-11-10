import Link from "next/link";
import {
  BudgetBar,
  dollars,
  eventLabel,
  money,
  PageHeader,
  percent,
  Rail,
  Shell,
  Stat,
  StatusPill,
  STATE_LABELS,
} from "@/components/ui";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";
import { NEEDS_YOU, ON_SITE, orgOverview } from "@/services/overview";

const ACTION_FOR: Partial<Record<string, string>> = {
  change_pending: "Decide on the declined purchase",
  draft: "Write the quote",
  quote_review: "Review and send the quote",
  accepted: "Open the job card",
  card_opening: "Check the card",
  invoice_review: "Review and send the invoice",
};

const since = (at: Date, now: Date) => {
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return at.toISOString().slice(0, 10);
};

export default async function DashboardPage() {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const now = new Date();
  const overview = await orgOverview(db, session.orgId, now);

  const needsYou = overview.jobs.filter((j) => NEEDS_YOU.includes(j.state));
  const onSite = overview.jobs.filter((j) => ON_SITE.includes(j.state) || j.state === "change_pending");
  const budgets = overview.jobs
    .filter((j) => j.limitCents !== null && j.quotedMaterialsCents !== null)
    .slice(0, 6);

  return (
    <Shell orgName={org.name}>
      <PageHeader
        title="Overview"
        meta={`${org.name}, ${now.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`}
        actions={
          <Link href="/jobs/new" className="btn btn-amber">
            Add a job
          </Link>
        }
      />

      {overview.jobs.length === 0 ? (
        <div className="ticket max-w-2xl">
          <h2 className="text-2xl">Add your first job</h2>
          <p className="mt-1 text-muted">
            Start with a few prices under Prices, then add a job. The quote is drafted from what
            you&apos;ve actually paid.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/jobs/new" className="btn btn-amber">
              Add a job
            </Link>
            <Link href="/prices" className="btn btn-quiet">
              Add prices
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Needs you" value={String(overview.needsYou)} note="Jobs waiting on a decision" />
            <Stat label="Open jobs" value={String(overview.openJobs)} note="Quoted through invoiced" />
            <Stat
              label="Card spend this month"
              value={dollars(overview.spendThisMonthCents)}
              note="Cleared and pending, across job cards"
            />
            <Stat
              label="True margin, paid jobs"
              value={percent(overview.paidMarginBps)}
              note={
                overview.paidMarginBps === null
                  ? "Shows once a job is paid"
                  : `On ${dollars(overview.paidRevenueCents)} billed`
              }
            />
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-8">
              <section>
                <h2 className="mb-3 text-2xl">Needs you</h2>
                {needsYou.length === 0 ? (
                  <p className="border border-line bg-white px-5 py-4 text-muted">
                    Nothing is waiting on you.
                  </p>
                ) : (
                  <ul className="divide-y divide-line border border-line bg-white">
                    {needsYou.map((job) => (
                      <li key={job.id}>
                        <Link
                          href={`/jobs/${job.id}`}
                          className={`flex items-center justify-between gap-4 border-l-4 px-4 py-3 hover:bg-paper ${job.state === "change_pending" ? "border-red" : "border-amber"}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{job.title}</span>
                            <span className="block text-sm text-muted">
                              {ACTION_FOR[job.state] ?? STATE_LABELS[job.state]}
                              {job.customer ? `, for ${job.customer}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold">Open</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 className="mb-3 text-2xl">On site</h2>
                {onSite.length === 0 ? (
                  <p className="border border-line bg-white px-5 py-4 text-muted">
                    No crews are out on a job card right now.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {onSite.map((job) => (
                      <li key={job.id}>
                        <Link href={`/jobs/${job.id}`} className="block border border-line bg-white px-4 py-3 hover:border-ink">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="truncate font-medium">{job.title}</span>
                            <StatusPill state={job.state} />
                          </div>
                          {job.limitCents !== null && (
                            <>
                              <Rail
                                committedCents={job.spentCents}
                                limitCents={job.limitCents}
                                height="h-3"
                                declined={job.state === "change_pending"}
                              />
                              <p className="mt-1.5 text-sm text-muted">
                                <span className="money text-ink">{money(job.spentCents)}</span> spent of{" "}
                                {money(job.limitCents)}
                              </p>
                            </>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="space-y-8">
              <section>
                <h2 className="text-2xl">Materials: spent vs quoted</h2>
                <p className="mb-3 text-sm text-muted">
                  <span aria-hidden className="mr-1 inline-block h-2.5 w-3 rounded-r-[3px] bg-amber align-middle" />
                  Spent on the job card
                  <span aria-hidden className="mx-1 ml-4 inline-block h-3 w-0.5 bg-ink align-middle" />
                  Quoted
                </p>
                {budgets.length === 0 ? (
                  <p className="border border-line bg-white px-5 py-4 text-muted">
                    Jobs appear here once their card is open.
                  </p>
                ) : (
                  <ul className="space-y-4 border border-line bg-white px-4 py-4">
                    {budgets.map((job) => (
                      <li key={job.id}>
                        <div className="mb-1.5 flex justify-between gap-3 text-sm">
                          <Link href={`/jobs/${job.id}`} className="truncate hover:underline">
                            {job.title}
                          </Link>
                          <span className="money shrink-0">
                            {dollars(job.spentCents)}
                            <span className="text-muted"> / {dollars(job.quotedMaterialsCents ?? 0)}</span>
                          </span>
                        </div>
                        <BudgetBar spentCents={job.spentCents} quotedCents={job.quotedMaterialsCents ?? 0} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 className="mb-3 text-2xl">Recent activity</h2>
                {overview.activity.length === 0 ? (
                  <p className="text-muted">Nothing yet.</p>
                ) : (
                  <ol className="space-y-3 border-l-2 border-line pl-4">
                    {overview.activity.map((event) => (
                      <li key={event.id} className="text-sm">
                        <Link href={`/jobs/${event.jobId}`} className="font-medium hover:underline">
                          {event.jobTitle}
                        </Link>
                        <span className="block text-muted">
                          {eventLabel(event.type)}
                          {", "}
                          {event.actor}, {since(event.at, now)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
