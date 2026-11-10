import Link from "next/link";
import {
  Card,
  EmptyState,
  PageHeader,
  Progress,
  RowLink,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
} from "@/components/app/primitives";
import { ago, DesktopOnly, MobileList, MobileRow, SearchBox } from "@/components/app/lists";
import { AppShell } from "@/components/app/shell";
import { money } from "@/components/ui";
import type { JobState } from "@/domain/transition";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";
import { listJobRows, NEEDS_YOU, ON_SITE, WAITING, type JobRow } from "@/services/overview";

const FILTERS: Array<{ key: string; label: string; empty: string; states: readonly JobState[] | null }> = [
  { key: "all", label: "All", empty: "No jobs yet", states: null },
  { key: "needs-you", label: "Needs attention", empty: "Nothing needs your attention", states: NEEDS_YOU },
  { key: "in-progress", label: "In progress", empty: "No crews are on a job right now", states: [...ON_SITE, "change_pending"] },
  { key: "waiting", label: "Waiting on customer", empty: "No jobs are waiting on a customer", states: WAITING },
  { key: "paid", label: "Paid", empty: "No paid jobs yet", states: ["settled"] },
  { key: "cancelled", label: "Cancelled", empty: "No cancelled jobs", states: ["cancelled"] },
];

/** Older links used these names. */
const ALIASES: Record<string, string> = { "on-site": "in-progress" };

function CardSpend({ row }: { row: JobRow }) {
  if (row.limitCents === null) return <span className="text-faint">No card yet</span>;
  return (
    <div className="w-44">
      <Progress value={row.spentCents} max={row.limitCents} declined={row.state === "change_pending"} />
      <span className="mt-1 block text-xs text-muted tabular-nums">
        {money(row.spentCents)} of {money(row.limitCents)}
      </span>
    </div>
  );
}

export default async function JobsPage(props: PageProps<"/jobs">) {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const params = await props.searchParams;
  const rawStatus = typeof params.status === "string" ? params.status : "all";
  const status = ALIASES[rawStatus] ?? rawStatus;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const now = new Date();

  const rows = await listJobRows(db, session.orgId);
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const needle = query.toLowerCase().replace(/^#/, "");
  const matches = (row: JobRow) =>
    !needle ||
    row.title.toLowerCase().includes(needle) ||
    (row.customer ?? "").toLowerCase().includes(needle) ||
    String(row.number) === needle;
  const searched = rows.filter(matches);
  const shown = searched.filter((row) => !filter.states || filter.states.includes(row.state));
  // Counts follow the search, so each tab says what clicking it will show.
  const countFor = (states: readonly JobState[] | null) =>
    states ? searched.filter((r) => states.includes(r.state)).length : searched.length;
  const hrefFor = (key: string) => {
    const search = new URLSearchParams();
    if (key !== "all") search.set("status", key);
    if (query) search.set("q", query);
    const text = search.toString();
    return text ? `/jobs?${text}` : "/jobs";
  };

  const newJob = (
    <Link href="/jobs/new" className="ui-btn ui-btn-primary">
      New job
    </Link>
  );

  return (
    <AppShell orgName={org.name} wide>
      <PageHeader
        title="Jobs"
        description="Every job from first quote to paid invoice, most recently updated first."
      />

      {/* The tab strip scrolls sideways on phones. Keep it from also scrolling a pixel vertically, and hide its scrollbar. */}
      <div className="[&>nav]:overflow-y-hidden [&>nav]:[scrollbar-width:none]">
        <Tabs
          tabs={FILTERS.map((f) => ({
            href: hrefFor(f.key),
            label: f.label,
            count: countFor(f.states),
            active: f.key === filter.key,
          }))}
        />
      </div>

      <Card
        flush
        title={
          query ? (
            <>
              {shown.length} {shown.length === 1 ? "result" : "results"} for &ldquo;{query}&rdquo;
            </>
          ) : (
            `${shown.length} ${shown.length === 1 ? "job" : "jobs"}`
          )
        }
        actions={
          <SearchBox
            action="/jobs"
            value={query}
            label="Search jobs"
            placeholder="Search jobs or customers"
            keep={filter.key === "all" ? {} : { status: filter.key }}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description="Each job you add shows up here with its status, its card spend and the quote total."
            action={newJob}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title={query ? "No jobs match your search" : filter.empty}
            description={
              query ? "Try a customer's name, part of the job title, or a job number." : "Jobs move here as their status changes."
            }
            action={
              <Link href="/jobs" className="ui-btn ui-btn-secondary ui-btn-sm">
                Show all jobs
              </Link>
            }
          />
        ) : (
          <>
            <MobileList>
              {shown.map((row) => (
                <MobileRow
                  key={row.id}
                  href={`/jobs/${row.id}`}
                  title={row.title}
                  subtitle={`#${row.number}${row.customer ? `, ${row.customer}` : ""}`}
                  aside={row.totalCents === null ? <span className="font-normal text-faint">No quote</span> : money(row.totalCents)}
                  meta={
                    <div className="flex items-center justify-between gap-3">
                      <StatusBadge state={row.state} />
                      {row.limitCents !== null ? (
                        <div className="flex w-36 items-center gap-2">
                          <Progress value={row.spentCents} max={row.limitCents} declined={row.state === "change_pending"} />
                          <span className="shrink-0 text-xs text-muted tabular-nums">{money(row.spentCents)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-faint">{ago(row.updatedAt, now)}</span>
                      )}
                    </div>
                  }
                />
              ))}
            </MobileList>
            <DesktopOnly>
              <Table minWidth="52rem">
                <THead>
                  <TH className="w-16">#</TH>
                  <TH>Job</TH>
                  <TH>Status</TH>
                  <TH className="w-48">Card</TH>
                  <TH align="right">Quote total</TH>
                  <TH align="right" className="w-28">
                    Updated
                  </TH>
                </THead>
                <TBody>
                  {shown.map((row) => (
                    <TR key={row.id} href={`/jobs/${row.id}`}>
                      <TD className="text-muted tabular-nums">{row.number}</TD>
                      <TD>
                        <RowLink href={`/jobs/${row.id}`}>{row.title}</RowLink>
                        <span className="block text-xs text-muted">{row.customer ?? "No customer"}</span>
                      </TD>
                      <TD>
                        <StatusBadge state={row.state} />
                      </TD>
                      <TD>
                        <CardSpend row={row} />
                      </TD>
                      <TD align="right">
                        {row.totalCents === null ? <span className="text-faint">None</span> : money(row.totalCents)}
                      </TD>
                      <TD align="right" className="text-muted">
                        <time dateTime={row.updatedAt.toISOString()} title={row.updatedAt.toLocaleString("en-US")}>
                          {ago(row.updatedAt, now)}
                        </time>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </DesktopOnly>
          </>
        )}
      </Card>
    </AppShell>
  );
}
