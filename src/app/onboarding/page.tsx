import { redirect } from "next/navigation";
import { createOrgAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { Field, FormError, FormFooter, FormSection, UnitInput } from "@/components/app/forms";
import { Wordmark } from "@/components/app/nav";
import { currentUserId, findSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const { db } = await getDeps();
  // No org exists yet, so there is no session to require: send anyone who has one on.
  if (await findSession(db, await currentUserId())) redirect("/dashboard");
  const { error } = await props.searchParams;

  return (
    <div className="app min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-xl px-4 py-10 sm:py-16">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold">Set up your business</h1>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-pretty text-muted">
            These numbers price every quote and set every card limit. You can change them later in Settings.
          </p>
        </div>
        <FormError message={error} />
        <form action={createOrgAction} className="rounded-lg border border-border bg-surface">
          <div className="divide-y divide-border">
            <FormSection stacked title="Business">
              <Field label="Business name" htmlFor="name" className="sm:col-span-2">
                <input id="name" name="name" required autoComplete="organization" placeholder="Rivera Plumbing" />
              </Field>
              <Field label="Your name" htmlFor="ownerName" optional>
                <input id="ownerName" name="ownerName" autoComplete="name" />
              </Field>
              <Field label="Approval email" htmlFor="contactEmail" help="Card approvals go here.">
                <input id="contactEmail" name="contactEmail" type="email" autoComplete="email" />
              </Field>
            </FormSection>
            <FormSection stacked title="Pricing" description="Typical numbers are filled in. Adjust them to match your shop.">
              <Field label="Labor cost per hour" htmlFor="laborCost" help="What crew time costs you.">
                <UnitInput unit="$" id="laborCost" name="laborCost" type="number" step="0.01" min="0" defaultValue="40" />
              </Field>
              <Field label="Labor bill rate per hour" htmlFor="laborBill" help="What you charge.">
                <UnitInput unit="$" id="laborBill" name="laborBill" type="number" step="0.01" min="0" defaultValue="120" />
              </Field>
              <Field label="Materials markup" htmlFor="markup">
                <UnitInput unit="%" side="end" id="markup" name="markup" type="number" step="0.01" min="0" defaultValue="25" />
              </Field>
              <Field label="Sales tax" htmlFor="tax">
                <UnitInput unit="%" side="end" id="tax" name="tax" type="number" step="0.01" min="0" defaultValue="8" />
              </Field>
              <Field
                label="Card buffer"
                htmlFor="buffer"
                help="Extra room on each job card above the quoted materials."
                className="sm:col-span-2"
              >
                <UnitInput unit="$" id="buffer" name="buffer" type="number" step="0.01" min="0" defaultValue="0" />
              </Field>
            </FormSection>
          </div>
          <FormFooter>
            <SubmitButton className="ui-btn ui-btn-primary" pending="Creating…">
              Create business
            </SubmitButton>
          </FormFooter>
        </form>
      </div>
    </div>
  );
}
