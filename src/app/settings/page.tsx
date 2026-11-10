import { eq } from "drizzle-orm";
import { connectRampAction, saveSettingsAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { Field, FormError, UnitInput } from "@/components/app/forms";
import { Badge, Card, PageHeader } from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { rampConnections } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

const RAMP_MODE = {
  shared_sandbox: "Shared sandbox",
  sandbox: "Sandbox",
  production: "Live",
} as const;

export default async function SettingsPage(props: PageProps<"/settings">) {
  const deps = await getDeps();
  const session = await requireSession(deps.db);
  const org = await loadOrg(deps.db, session.orgId);
  const { error } = await props.searchParams;
  const [connection] = await deps.db
    .select()
    .from(rampConnections)
    .where(eq(rampConnections.orgId, session.orgId));

  const services: Array<{ name: string; on: boolean; help: string; detail?: string }> = [
    {
      name: "Ramp",
      on: Boolean(connection),
      help: connection ? "Each accepted job gets its own card with a hard limit." : "Job cards can't open until Ramp is connected.",
      detail: connection ? RAMP_MODE[connection.mode] : undefined,
    },
    {
      name: "Claude",
      on: Boolean(deps.claude),
      help: deps.claude ? "Drafts quotes and reads receipts." : "Quotes and receipts are entered by hand.",
    },
    {
      name: "Speech to text",
      on: Boolean(deps.transcriber),
      help: deps.transcriber ? "Crews record their end-of-job note." : "Crews type their end-of-job note.",
    },
    {
      name: "Email",
      on: Boolean(process.env.RESEND_API_KEY),
      help: process.env.RESEND_API_KEY
        ? "Quotes, approvals and invoices are emailed."
        : "Nothing is emailed. Messages wait on the Messages page.",
    },
  ];

  return (
    <AppShell orgName={org.name}>
      <PageHeader title="Settings" description="Your rates price every quote and set every card limit." />
      <FormError message={error} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form action={saveSettingsAction} className="min-w-0 space-y-4">
          <Card title="Business" description="Shown to customers on quotes and invoices.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" htmlFor="name">
                <input id="name" name="name" required defaultValue={org.name} autoComplete="organization" />
              </Field>
              <Field label="Approval email" htmlFor="contactEmail" help="Card approvals and limit raises go here.">
                <input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  defaultValue={org.contactEmail ?? ""}
                  placeholder="you@yourbusiness.com"
                  autoComplete="email"
                />
              </Field>
            </div>
          </Card>

          <Card title="Pricing" description="Used for every new quote and card. Quotes already sent keep their numbers.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Labor cost per hour" htmlFor="laborCost" help="What an hour of crew time costs you.">
                <UnitInput unit="$" id="laborCost" name="laborCost" type="number" step="0.01" min="0" defaultValue={org.laborCostCentsPerHour / 100} />
              </Field>
              <Field label="Labor bill rate per hour" htmlFor="laborBill" help="What you charge the customer.">
                <UnitInput unit="$" id="laborBill" name="laborBill" type="number" step="0.01" min="0" defaultValue={org.laborBillCentsPerHour / 100} />
              </Field>
              <Field label="Materials markup" htmlFor="markup" help="Added on top of what you pay for parts.">
                <UnitInput unit="%" side="end" id="markup" name="markup" type="number" step="0.01" min="0" defaultValue={org.markupBps / 100} />
              </Field>
              <Field label="Sales tax" htmlFor="tax" help="Charged on the quote total.">
                <UnitInput unit="%" side="end" id="tax" name="tax" type="number" step="0.01" min="0" defaultValue={org.taxRateBps / 100} />
              </Field>
              <Field
                label="Card buffer"
                htmlFor="buffer"
                help="Extra room on each job card above the quoted materials, for small surprises."
              >
                <UnitInput unit="$" id="buffer" name="buffer" type="number" step="0.01" min="0" defaultValue={org.cardBufferCents / 100} />
              </Field>
            </div>
          </Card>

          <Card title="Invoices" description="What goes out with each invoice.">
            <div className="flex items-start gap-3">
              <input
                id="attachReceipts"
                type="checkbox"
                name="attachReceipts"
                defaultChecked={org.attachReceiptsToInvoice}
                className="m-0 mt-0.5 h-4 w-4 shrink-0 accent-ink"
              />
              <div>
                <label htmlFor="attachReceipts">Attach receipts to invoices</label>
                <p className="mt-0.5 text-xs text-muted">Receipts show what you paid, so customers can work out your markup.</p>
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
            <p className="mr-auto text-xs text-muted">Changes apply to new quotes and cards.</p>
            <SubmitButton className="ui-btn ui-btn-primary" pending="Saving…">
              Save changes
            </SubmitButton>
          </div>
        </form>

        <Card flush className="xl:sticky xl:top-20" title="Connections" description="The services Bookend works through.">
          <ul className="divide-y divide-border">
            {services.map((s) => (
              <li key={s.name} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-medium">
                    {s.name}
                    {s.detail && <span className="ml-1.5 font-normal text-muted">{s.detail}</span>}
                  </p>
                  <Badge tone={s.on ? "success" : "muted"}>{s.on ? "Connected" : "Not connected"}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">{s.help}</p>
                {s.name === "Ramp" && !connection && deps.ramp && (
                  <form action={connectRampAction} className="mt-2.5">
                    <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Connecting…">
                      Connect Ramp
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {connection && connection.mode !== "production" && (
            <p className="rounded-b-lg border-t border-border bg-subtle/50 px-4 py-3 text-xs text-muted">
              This is a Ramp sandbox. No real money moves, and cards can&apos;t be used at real shops.
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
