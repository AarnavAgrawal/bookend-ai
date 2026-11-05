import { eq } from "drizzle-orm";
import { connectRampAction, saveSettingsAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote, Section, Shell } from "@/components/ui";
import { rampConnections } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

export default async function SettingsPage(props: PageProps<"/settings">) {
  const deps = await getDeps();
  const session = await requireSession(deps.db);
  const org = await loadOrg(deps.db, session.orgId);
  const { error } = await props.searchParams;
  const [connection] = await deps.db
    .select()
    .from(rampConnections)
    .where(eq(rampConnections.orgId, session.orgId));

  const services: Array<[string, boolean, string]> = [
    ["Ramp", Boolean(connection), "Job cards can't open until this is connected."],
    ["Claude", Boolean(deps.claude), "Quotes and receipts are entered by hand."],
    ["Speech to text", Boolean(deps.transcriber), "Crew type their end-of-job note."],
    [
      "Email",
      Boolean(process.env.RESEND_API_KEY),
      "Nothing is emailed. Messages wait on the Messages page.",
    ],
  ];

  return (
    <Shell orgName={org.name}>
      <h1 className="mb-6 text-4xl">Settings</h1>
      <ErrorNote message={error} />

      <form action={saveSettingsAction} className="max-w-xl space-y-4">
        <label>
          Business name
          <input name="name" required defaultValue={org.name} />
        </label>
        <label>
          Email for approvals
          <input name="contactEmail" type="email" defaultValue={org.contactEmail ?? ""} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label>
            Labor cost per hour ($)
            <input
              name="laborCost"
              type="number"
              step="0.01"
              min="0"
              defaultValue={org.laborCostCentsPerHour / 100}
            />
          </label>
          <label>
            Labor billed per hour ($)
            <input
              name="laborBill"
              type="number"
              step="0.01"
              min="0"
              defaultValue={org.laborBillCentsPerHour / 100}
            />
          </label>
          <label>
            Materials markup (%)
            <input name="markup" type="number" step="0.01" min="0" defaultValue={org.markupBps / 100} />
          </label>
          <label>
            Sales tax (%)
            <input name="tax" type="number" step="0.01" min="0" defaultValue={org.taxRateBps / 100} />
          </label>
          <label className="col-span-2">
            Extra room on each card ($)
            <input
              name="buffer"
              type="number"
              step="0.01"
              min="0"
              defaultValue={org.cardBufferCents / 100}
            />
          </label>
        </div>
        <label className="flex items-center">
          <input
            type="checkbox"
            name="attachReceipts"
            defaultChecked={org.attachReceiptsToInvoice}
          />
          Attach receipts to invoices (these can show customers your markup)
        </label>
        <SubmitButton>Save settings</SubmitButton>
      </form>

      <Section title="Connections">
        <ul className="max-w-xl border-t-2 border-ink">
          {services.map(([name, on, off]) => (
            <li key={name} className="border-b border-line py-2">
              <span className="font-medium">{name}: </span>
              <span className={on ? "" : "text-muted"}>{on ? "connected" : off}</span>
            </li>
          ))}
        </ul>
        {connection && connection.mode !== "production" && (
          <p className="mt-3 text-sm text-muted">
            This is a Ramp sandbox. No real money moves, and cards can&apos;t be used at real shops.
          </p>
        )}
        {!connection && deps.ramp && (
          <form action={connectRampAction} className="mt-4">
            <SubmitButton className="btn btn-amber">Connect Ramp</SubmitButton>
          </form>
        )}
      </Section>
    </Shell>
  );
}
