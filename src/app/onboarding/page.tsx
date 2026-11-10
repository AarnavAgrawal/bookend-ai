import { redirect } from "next/navigation";
import { createOrgAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote } from "@/components/ui";
import { currentUserId, findSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const { db } = await getDeps();
  if (await findSession(db, await currentUserId())) redirect("/dashboard");
  const { error } = await props.searchParams;

  return (
    <div className="mx-auto max-w-lg px-5 py-12">
      <h1 className="text-4xl">Set up your business</h1>
      <p className="mt-2 mb-6 text-muted">
        These numbers price every quote. You can change them later in Settings.
      </p>
      <ErrorNote message={error} />
      <form action={createOrgAction} className="space-y-4">
        <label>
          Business name
          <input name="name" required />
        </label>
        <label>
          Your name
          <input name="ownerName" />
        </label>
        <label>
          Email for approvals
          <input name="contactEmail" type="email" />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label>
            Labor cost per hour ($)
            <input name="laborCost" type="number" step="0.01" min="0" defaultValue="40" />
          </label>
          <label>
            Labor billed per hour ($)
            <input name="laborBill" type="number" step="0.01" min="0" defaultValue="120" />
          </label>
          <label>
            Materials markup (%)
            <input name="markup" type="number" step="0.01" min="0" defaultValue="25" />
          </label>
          <label>
            Sales tax (%)
            <input name="tax" type="number" step="0.01" min="0" defaultValue="8" />
          </label>
          <label className="col-span-2">
            Extra room on each card ($)
            <input name="buffer" type="number" step="0.01" min="0" defaultValue="0" />
          </label>
        </div>
        <SubmitButton className="btn btn-amber">Create business</SubmitButton>
      </form>
    </div>
  );
}
