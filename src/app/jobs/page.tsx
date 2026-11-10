import Link from "next/link";
import {
  dollars,
  money,
  PageHeader,
  Rail,
  Shell,
  StatusPill,
} from "@/components/ui";
import type { JobState } from "@/domain/transition";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";
import {
  FINISHED,
  listJobRows,
  NEEDS_YOU,
  ON_SITE,
  WAITING,
} from "@/services/overview";

const FILTERS: Array<{
  key: string;
  label: string;
  states: readonly JobState[] | null;
}> = [
  { key: "all", label: "All", states: null },
  { key: "needs-you", label: "Needs you", states: NEEDS_YOU },
  { key: "on-site", label: "On site", states: [...ON_SITE, "change_pending"] },
  { key: "waiting", label: "Waiting", states: WAITING },
  { key: "finished", label: "Finished", states: FINISHED },
];

export default async function JobsPage(props: PageProps<"/jobs">) {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const params = await props.searchParams;
  const status = typeof params.status === "string" ? params.status : "all";
  const query = typeof params.q === "string" ? params.q.trim() : "";

  const rows = await listJobRows(db, session.orgId);
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const needle = query.toLowerCase();
  const shown = rows.filter(
    (row) =>
      (!filter.states || filter.states.includes(row.state)) &&
      (!needle ||
        row.title.toLowerCase().includes(needle) ||
        (row.customer ?? "").toLowerCase().includes(needle) ||
        String(row.number) === needle),
  );
  const countFor = (states: readonly JobState[] | null) =>
    states ? rows.filter((r) => states.includes(r.state)).length : rows.length;
  const hrefFor = (key: string) => {
    const search = new URLSearchParams();
    if (key !== "all") search.set("status", key);
    if (query) search.set("q", query);
    const text = search.toString();
    return text ? `/jobs?${text}` : "/jobs";
  };

  return (
    <Shell orgName={org.name}>
      <PageHeader
        title="Jobs"
        meta={`${rows.length} ${rows.length === 1 ? "job" : "jobs"}`}
        actions={
          <Link href="/jobs/new" className="btn btn-amber">
            Add a job
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter jobs" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const active = f.key === filter.key;
            return (
              <Link
                key={f.key}
                href={hrefFor(f.key)}
                aria-current={active ? "page" : undefined}
                className={`border px-3 py-1.5 text-sm ${active ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink"}`}
              >
                {f.label}{" "}
                <span className={active ? "text-paper/70" : "text-muted"}>
                  {countFor(f.states)}
                </span>
              </Link>
            );
          })}
        </nav>
        <form action="/jobs" className="flex w-full gap-2 sm:w-72">
          {filter.key !== "all" && (
            <input type="hidden" name="status" value={filter.key} />
          )}
          <label className="sr-only" htmlFor="job-search">
            Search jobs
          </label>
          <input
            id="job-search"
            name="q"
            defaultValue={query}
            placeholder="Search by job, customer or number"
          />
        </form>
      </div>

      {shown.length === 0 ? (
        <div className="border border-line bg-white px-5 py-10 text-center">
          <p className="font-medium">
            {rows.length === 0 ? "No jobs yet" : "No jobs match"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {rows.length === 0 ? (
              <Link href="/jobs/new" className="underline">
                Add your first job
              </Link>
            ) : (
              <Link href="/jobs" className="underline">
                Show all jobs
              </Link>
            )}
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line border border-line bg-white sm:hidden">
            {shown.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/jobs/${row.id}`}
                  className="block px-4 py-3 hover:bg-paper"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{row.title}</span>
                      <span className="block text-sm text-muted">
                        <span className="money">#{row.number}</span>
                        {row.customer ? `, ${row.customer}` : ""}
                      </span>
                    </span>
                    <span className="money shrink-0">
                      {row.totalCents === null ? "" : money(row.totalCents)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <StatusPill state={row.state} />
                    {row.limitCents !== null && (
                      <span className="text-xs text-muted">
                        {dollars(row.spentCents)} of {dollars(row.limitCents)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border border-line bg-white sm:block">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b-2 border-ink">
                <tr className="text-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Job
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="w-44 px-4 py-2.5 font-medium">
                    Card
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-right font-medium"
                  >
                    Quote
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((row) => (
                  <tr key={row.id} className="group hover:bg-paper">
                    <td className="money px-4 py-3 text-muted">{row.number}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/jobs/${row.id}`}
                        className="font-medium group-hover:underline"
                      >
                        {row.title}
                      </Link>
                      <span className="block text-muted">{row.customer}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill state={row.state} />
                    </td>
                    <td className="px-4 py-3">
                      {row.limitCents === null ? (
                        <span className="text-muted">No card yet</span>
                      ) : (
                        <>
                          <Rail
                            committedCents={row.spentCents}
                            limitCents={row.limitCents}
                            height="h-2"
                            declined={row.state === "change_pending"}
                          />
                          <span className="mt-1 block text-xs text-muted">
                            {dollars(row.spentCents)} of{" "}
                            {dollars(row.limitCents)}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="money px-4 py-3 text-right text-base">
                      {row.totalCents === null ? (
                        <span className="text-muted">None</span>
                      ) : (
                        money(row.totalCents)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}
