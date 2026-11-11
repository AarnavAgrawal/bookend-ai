import { eq } from "drizzle-orm";
import { AskChat } from "@/components/app/ask";
import { Card, EmptyState, PageHeader } from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { jobs } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

export default async function AskPage(props: PageProps<"/ask">) {
  const deps = await getDeps();
  const session = await requireSession(deps.db);
  const org = await loadOrg(deps.db, session.orgId);
  const { q } = await props.searchParams;
  const question = typeof q === "string" && q.trim() ? q.trim().slice(0, 2000) : null;

  // So answers can link "#4" straight to the job.
  const rows = await deps.db
    .select({ id: jobs.id, number: jobs.jobNumber })
    .from(jobs)
    .where(eq(jobs.orgId, session.orgId));
  const links = Object.fromEntries(rows.map((r) => [String(r.number), r.id]));

  return (
    <AppShell orgName={org.name}>
      <PageHeader
        title="Ask Bookend"
        description="Questions about your jobs, cards and prices, answered from your own records."
      />
      {deps.claude ? (
        <AskChat key={question ?? "new"} jobs={links} initialQuestion={question} />
      ) : (
        <Card>
          <EmptyState
            title="Ask Bookend needs Claude"
            description="Add an Anthropic API key to the app's settings, and questions about your jobs and spend can be answered here."
          />
        </Card>
      )}
    </AppShell>
  );
}
