import { eq } from "drizzle-orm";
import Link from "next/link";
import {
  Card,
  EmptyState,
  PageHeader,
  Progress,
  RowLink,
  Stat,
  StatStrip,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/app/primitives";
import { DesktopOnly, MobileList, MobileRow } from "@/components/app/lists";
import { AppShell } from "@/components/app/shell";
import { SpendChart } from "@/components/app/spend-chart";
import { dollars, eventLabel, money, percent } from "@/components/ui";
import { priceObservations, rampConnections } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";
import { NEEDS_YOU, orgOverview } from "@/services/overview";

const NEXT_STEP: Partial<Record<string, string>> = {
  change_pending: "Decide on a declined purchase",
  draft: "Write the quote",
  quote_review: "Send the quote",
  accepted: "Open the job card",
  card_opening: "Check the card",
  invoice_review: "Send the invoice",
};

const ago = (at: Date, now: Date) => {
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default async function OverviewPage() {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const now = new Date();
  const overview = await orgOverview(db, session.orgId, now);

  const attention = overview.jobs.filter((j) => NEEDS_YOU.includes(j.state));
  const inProgress = overview.jobs.filter(
    (j) => j.limitCents !== null && ["active", "change_pending", "closing"].includes(j.state),
  );

  if (overview.jobs.length === 0) {
    const [prices] = await db
      .select({ id: priceObservations.id })
      .from(priceObservations)
      .where(eq(priceObservations.orgId, session.orgId))
      .limit(1);
    const [ramp] = await db
      .select({ id: rampConnections.id })
      .from(rampConnections)
      .where(eq(rampConnections.orgId, session.orgId));
    const steps = [
      { done: Boolean(ramp), title: "Connect Ramp", detail: "Each job gets its own card with a hard limit.", href: "/settings", cta: "Open settings" },
      { done: Boolean(prices), title: "Add your prices", detail: "Quotes cite what you have actually paid.", href: "/prices", cta: "Open price book" },
      { done: false, title: "Create your first job", detail: "Describe the work and send the quote.", href: "/jobs/new", cta: "New job" },
    ];
    return (
      <AppShell orgName={org.name}>
        <PageHeader title={`Welcome, ${org.name}`} description="Three steps to your first job card." />
        <Card flush className="max-w-2xl">
          <ol className="divide-y divide-border">
            {steps.map((step, i) => (
              <li key={step.title} className="flex items-center gap-4 px-4 py-3.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? "bg-success text-white" : "border border-border text-muted"}`}
                >
                  {step.done ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${step.done ? "text-muted line-through" : ""}`}>{step.title}</p>
                  <p className="text-[13px] text-muted">{step.detail}</p>
                </div>
                {!step.done && (
                  <Link href={step.href} className="ui-btn ui-btn-secondary ui-btn-sm">
                    {step.cta}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell orgName={org.name}>
      <PageHeader
        title="Overview"
        description={now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      />

      <StatStrip>
        <Stat
          label="Needs your attention"
          value={overview.needsYou}
          detail={overview.needsYou === 1 ? "1 job is waiting on you" : `${overview.needsYou} jobs are waiting on you`}
        />
        <Stat label="Open jobs" value={overview.openJobs} detail="From draft to invoiced" />
        <Stat label="Card spend this month" value={dollars(overview.spendThisMonthCents)} detail="Across all job cards" />
        <Stat
          label="True margin on paid jobs"
          value={percent(overview.paidMarginBps)}
          detail={overview.paidMarginBps === null ? "Appears when a job is paid" : `On ${dollars(overview.paidRevenueCents)} billed before tax`}
        />
      </StatStrip>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card
          className="lg:col-span-8"
          flush
          title="Needs your attention"
          actions={
            <Link href="/jobs?status=needs-you" className="ui-btn ui-btn-ghost ui-btn-sm">
              View all
            </Link>
          }
        >
          {attention.length === 0 ? (
            <EmptyState title="You're all caught up" description="Jobs that need a quote, an approval or an invoice will show up here." />
          ) : (
            <>
              <MobileList>
                {attention.slice(0, 6).map((job) => (
                  <MobileRow
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    title={job.title}
                    subtitle={`#${job.number}${job.customer ? `, ${job.customer}` : ""}`}
                    aside={job.totalCents === null ? <span className="font-normal text-faint">No quote</span> : money(job.totalCents)}
                    meta={
                      <div className="flex items-center justify-between gap-3">
                        <StatusBadge state={job.state} />
                        <span className="truncate text-xs text-muted">{NEXT_STEP[job.state]}</span>
                      </div>
                    }
                  />
                ))}
              </MobileList>
              <DesktopOnly>
                <Table>
                  <THead>
                    <TH>Job</TH>
                    <TH>Status</TH>
                    <TH>Next step</TH>
                    <TH align="right">Quote</TH>
                  </THead>
                  <TBody>
                    {attention.slice(0, 6).map((job) => (
                      <TR key={job.id} href={`/jobs/${job.id}`}>
                        <TD>
                          <RowLink href={`/jobs/${job.id}`}>{job.title}</RowLink>
                          <span className="block text-xs text-muted">
                            #{job.number}
                            {job.customer ? `, ${job.customer}` : ""}
                          </span>
                        </TD>
                        <TD>
                          <StatusBadge state={job.state} />
                        </TD>
                        <TD className="text-muted">{NEXT_STEP[job.state]}</TD>
                        <TD align="right">{job.totalCents === null ? <span className="text-faint">None</span> : money(job.totalCents)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </DesktopOnly>
            </>
          )}
        </Card>

        <Card className="lg:col-span-4" title="Card spend">
          <SpendChart days={overview.spendByDay} />
        </Card>

        <Card
          className="lg:col-span-12"
          flush
          title="Jobs in progress"
          description="Spend on each job's card against its limit"
          actions={
            <Link href="/cards" className="ui-btn ui-btn-ghost ui-btn-sm">
              All cards
            </Link>
          }
        >
          {inProgress.length === 0 ? (
            <EmptyState title="No crews are on a job right now" description="When a customer accepts and the card opens, the job shows up here with its spend." />
          ) : (
            <>
              <MobileList>
                {inProgress.map((job) => {
                  const limit = job.limitCents ?? 0;
                  return (
                    <MobileRow
                      key={job.id}
                      href={`/jobs/${job.id}`}
                      title={job.title}
                      subtitle={job.customer ?? undefined}
                      aside={<StatusBadge state={job.state} />}
                      meta={
                        <div>
                          <Progress value={job.spentCents} max={limit} declined={job.state === "change_pending"} />
                          <p className="mt-1 flex justify-between text-xs text-muted tabular-nums">
                            <span>
                              {money(job.spentCents)} of {money(limit)}
                            </span>
                            <span>{money(Math.max(0, limit - job.spentCents))} left</span>
                          </p>
                        </div>
                      }
                    />
                  );
                })}
              </MobileList>
              <DesktopOnly>
                <Table minWidth="44rem">
                  <THead>
                    <TH>Job</TH>
                    <TH>Status</TH>
                    <TH className="w-[30%]">Budget used</TH>
                    <TH align="right">Spent</TH>
                    <TH align="right">Remaining</TH>
                  </THead>
                  <TBody>
                    {inProgress.map((job) => {
                      const limit = job.limitCents ?? 0;
                      return (
                        <TR key={job.id} href={`/jobs/${job.id}`}>
                          <TD>
                            <RowLink href={`/jobs/${job.id}`}>{job.title}</RowLink>
                            <span className="block text-xs text-muted">{job.customer}</span>
                          </TD>
                          <TD>
                            <StatusBadge state={job.state} />
                          </TD>
                          <TD>
                            <div className="flex items-center gap-3">
                              <Progress value={job.spentCents} max={limit} declined={job.state === "change_pending"} />
                              <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">
                                {limit > 0 ? `${Math.round((job.spentCents / limit) * 100)}%` : "0%"}
                              </span>
                            </div>
                          </TD>
                          <TD align="right">{money(job.spentCents)}</TD>
                          <TD align="right">{money(Math.max(0, limit - job.spentCents))}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </DesktopOnly>
            </>
          )}
        </Card>

        <Card className="lg:col-span-7" flush title="Recent activity">
          {overview.activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-border">
              {overview.activity.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px]">
                      <span className="font-medium">{eventLabel(event.type)}</span>
                      <span className="text-muted"> on </span>
                      <Link href={`/jobs/${event.jobId}`} className="hover:underline">
                        {event.jobTitle}
                      </Link>
                    </p>
                    <p className="text-xs text-muted">by {event.actor}</p>
                  </div>
                  <time className="shrink-0 text-xs text-faint tabular-nums" dateTime={event.at.toISOString()}>
                    {ago(event.at, now)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-5" flush title="Recently paid" description="Billed amounts are before tax">
          {overview.paidJobs.length === 0 ? (
            <EmptyState title="No paid jobs yet" description="Once a job is paid, its true margin shows here." />
          ) : (
            <Table minWidth="20rem">
              <THead>
                <TH>Job</TH>
                <TH align="right">Billed</TH>
                <TH align="right">Margin</TH>
              </THead>
              <TBody>
                {overview.paidJobs.map((job) => (
                  <TR key={job.id} href={`/jobs/${job.id}`}>
                    <TD>
                      <RowLink href={`/jobs/${job.id}`}>{job.title}</RowLink>
                    </TD>
                    <TD align="right">{money(job.billedCents)}</TD>
                    <TD align="right">
                      <span className={job.marginCents >= 0 ? "text-success" : "text-danger"}>{percent(job.marginBps)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
