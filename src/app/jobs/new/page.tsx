import Link from "next/link";
import { createJobAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { Field, FormError, FormFooter, FormSection } from "@/components/app/forms";
import { PageHeader } from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

export default async function NewJobPage(props: PageProps<"/jobs/new">) {
  const deps = await getDeps();
  const { db } = deps;
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const { error } = await props.searchParams;

  return (
    <AppShell orgName={org.name}>
      <PageHeader
        title="New job"
        description="Describe the work and who it's for. You'll write the quote on the next screen."
        crumbs={[{ href: "/jobs", label: "Jobs" }]}
      />
      <div className="max-w-4xl">
        <FormError message={error} />
        <form action={createJobAction} className="rounded-lg border border-border bg-surface">
          <div className="divide-y divide-border">
            <FormSection title="Job" description="What the customer sees at the top of the quote.">
              <Field label="Title" htmlFor="title" className="sm:col-span-2">
                <input id="title" name="title" required placeholder="Replace 50 gallon water heater" />
              </Field>
              <Field
                label="Details for the quote"
                htmlFor="description"
                optional
                help={deps.claude ? "Claude reads this when it drafts the quote." : "Shown to the customer above the quote."}
                className="sm:col-span-2"
              >
                <textarea
                  id="description"
                  name="description"
                  rows={4}
                  placeholder="Basement install, old unit leaking, gas line already in place."
                />
              </Field>
            </FormSection>
            <FormSection title="Customer" description="Where the quote and the invoice go.">
              <Field label="Name" htmlFor="customerName" className="sm:col-span-2">
                <input id="customerName" name="customerName" required autoComplete="off" />
              </Field>
              <Field label="Email" htmlFor="customerEmail" optional>
                <input id="customerEmail" name="customerEmail" type="email" autoComplete="off" />
              </Field>
              <Field label="Phone" htmlFor="customerPhone" optional>
                <input id="customerPhone" name="customerPhone" type="tel" autoComplete="off" />
              </Field>
              <Field label="Job address" htmlFor="customerAddress" optional className="sm:col-span-2">
                <input id="customerAddress" name="customerAddress" autoComplete="off" />
              </Field>
            </FormSection>
          </div>
          <FormFooter>
            <Link href="/jobs" className="ui-btn ui-btn-secondary">
              Cancel
            </Link>
            <SubmitButton className="ui-btn ui-btn-primary" pending="Creating…">
              Create job
            </SubmitButton>
          </FormFooter>
        </form>
      </div>
    </AppShell>
  );
}
