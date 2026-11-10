import Link from "next/link";
import { DesktopOnly, MobileList, MobileRow, shortDate } from "@/components/app/lists";
import { Card, EmptyState, PageHeader, RowLink, Table, TBody, TD, TH, THead, TR } from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { money } from "@/components/ui";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";
import { listCustomers } from "@/services/lists";

export default async function CustomersPage() {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const now = new Date();
  const customers = await listCustomers(db, session.orgId);
  const jobsHref = (name: string) => `/jobs?q=${encodeURIComponent(name)}`;

  return (
    <AppShell orgName={org.name} wide>
      <PageHeader
        title="Customers"
        description="Everyone you've quoted, with their jobs and what they've paid."
      />
      <Card flush title={`${customers.length} ${customers.length === 1 ? "customer" : "customers"}`}>
        {customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="A customer is added with each new job. Their jobs and paid invoices add up here."
            action={
              <Link href="/jobs/new" className="ui-btn ui-btn-secondary ui-btn-sm">
                New job
              </Link>
            }
          />
        ) : (
          <>
            <MobileList>
              {customers.map((c) => (
                <MobileRow
                  key={c.name}
                  href={jobsHref(c.name)}
                  title={c.name}
                  subtitle={c.email ?? c.phone ?? "No contact details"}
                  aside={c.billedCents > 0 ? money(c.billedCents) : <span className="font-normal text-faint">$0.00</span>}
                  meta={
                    <p className="text-xs text-muted">
                      {c.jobCount} {c.jobCount === 1 ? "job" : "jobs"}
                      {c.lastJob ? `. Last: ${c.lastJob.title}, ${shortDate(c.lastJob.at, now)}` : ""}
                    </p>
                  }
                />
              ))}
            </MobileList>
            <DesktopOnly>
              <Table minWidth="48rem">
                <THead>
                  <TH>Name</TH>
                  <TH>Email or phone</TH>
                  <TH align="right">Jobs</TH>
                  <TH align="right">Billed before tax</TH>
                  <TH>Last job</TH>
                </THead>
                <TBody>
                  {customers.map((c) => (
                    <TR key={c.name} href={jobsHref(c.name)}>
                      <TD>
                        <RowLink href={jobsHref(c.name)}>{c.name}</RowLink>
                      </TD>
                      <TD className="text-muted">
                        {c.email ?? c.phone ?? <span className="text-faint">None</span>}
                        {c.email && c.phone && <span className="block text-xs text-faint">{c.phone}</span>}
                      </TD>
                      <TD align="right">{c.jobCount}</TD>
                      <TD align="right">
                        {c.billedCents > 0 ? money(c.billedCents) : <span className="text-faint">$0.00</span>}
                      </TD>
                      <TD>
                        {c.lastJob ? (
                          <>
                            <span className="block max-w-[18rem] truncate">{c.lastJob.title}</span>
                            <span className="block text-xs text-muted">{shortDate(c.lastJob.at, now)}</span>
                          </>
                        ) : (
                          <span className="text-faint">None</span>
                        )}
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
