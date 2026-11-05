import { createJobAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote, Shell } from "@/components/ui";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

export default async function NewJobPage(props: PageProps<"/jobs/new">) {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const { error } = await props.searchParams;

  return (
    <Shell orgName={org.name}>
      <h1 className="mb-6 text-4xl">Add a job</h1>
      <ErrorNote message={error} />
      <form action={createJobAction} className="max-w-xl space-y-4">
        <label>
          What&apos;s the job?
          <input name="title" required placeholder="Replace 50 gallon water heater" />
        </label>
        <label>
          Details for the quote
          <textarea
            name="description"
            rows={4}
            placeholder="Basement install, old unit leaking, gas line already in place."
          />
        </label>
        <label>
          Customer name
          <input name="customerName" required />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            Customer email
            <input name="customerEmail" type="email" />
          </label>
          <label>
            Customer phone
            <input name="customerPhone" type="tel" />
          </label>
        </div>
        <label>
          Job address
          <input name="customerAddress" />
        </label>
        <SubmitButton className="btn btn-amber">Add job</SubmitButton>
      </form>
    </Shell>
  );
}
