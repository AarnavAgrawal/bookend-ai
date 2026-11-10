import { Badge, Card, KeyValue, Progress } from "@/components/app/primitives";
import { money, percent } from "@/components/ui";
import { CopyField } from "./client";
import type { JobView } from "./model";

const none = <span className="font-normal text-faint">None</span>;

const FUND_STATE = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Frozen", tone: "neutral" },
  terminated: { label: "Closed", tone: "muted" },
} as const;

function CustomerCard({ view }: { view: JobView }) {
  const c = view.customer;
  if (!c) return null;
  return (
    <Card title="Customer">
      <KeyValue
        items={[
          { label: "Name", value: c.name },
          {
            label: "Email",
            value: c.email ? (
              <a href={`mailto:${c.email}`} className="break-all hover:underline">
                {c.email}
              </a>
            ) : (
              none
            ),
          },
          {
            label: "Phone",
            value: c.phone ? (
              <a href={`tel:${c.phone}`} className="normal-nums hover:underline">
                {c.phone}
              </a>
            ) : (
              none
            ),
          },
          { label: "Address", value: c.address ? <span className="text-pretty">{c.address}</span> : none },
        ]}
      />
    </Card>
  );
}

function JobCardCard({ view }: { view: JobView }) {
  const { fund, spend, job } = view;
  if (!fund) {
    const limit = view.limitPreviewCents !== null && (
      <span className="font-medium text-ink tabular-nums">{money(view.limitPreviewCents)}</span>
    );
    const opening = job.state === "accepted" || job.state === "card_opening";
    return (
      <Card title="Job card">
        <p className="text-[13px] text-muted">
          {job.state === "cancelled" ? (
            "This job never had a card."
          ) : opening ? (
            <>
              Not open yet. {job.state === "card_opening" ? "Ramp is creating" : "Opening it creates"} a card
              {limit && <> limited to {limit}</>}.
            </>
          ) : (
            <>
              No card yet. It opens after the customer accepts{limit && <>, limited to {limit}</>}.
            </>
          )}
        </p>
      </Card>
    );
  }
  const declined = job.state === "change_pending";
  const used = fund.limitCents > 0 ? Math.round((spend.committedCents / fund.limitCents) * 100) : 0;
  const state = FUND_STATE[fund.state];
  return (
    <Card title="Job card" actions={<Badge tone={state.tone}>{state.label}</Badge>}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className={declined ? "font-medium text-danger" : "text-muted"}>
          {declined
            ? "Declined a purchase"
            : spend.nearLimit && job.state === "active"
              ? "Close to the limit"
              : "Spent against the limit"}
        </span>
        <span className="text-muted tabular-nums">{used}%</span>
      </div>
      <Progress value={spend.committedCents} max={fund.limitCents} declined={declined} />
      <div className="mt-4">
        <KeyValue
          items={[
            { label: "Limit", value: money(fund.limitCents) },
            { label: "Spent", value: money(spend.committedCents) },
            ...(spend.pendingCents > 0 ? [{ label: "Of which pending", value: money(spend.pendingCents) }] : []),
            { label: "Remaining", value: money(spend.remainingCents) },
          ]}
        />
      </div>
    </Card>
  );
}

function MoneyCard({ view }: { view: JobView }) {
  const { quote, invoice, margin } = view;
  const marginValue =
    invoice && margin ? (
      <span className={margin.marginCents >= 0 ? "text-success" : "text-danger"}>
        {money(margin.marginCents)} ({percent(margin.marginBps)})
      </span>
    ) : (
      <span className="font-normal text-faint">After invoicing</span>
    );
  return (
    <Card title="Money">
      <KeyValue
        items={[
          { label: "Quote total", value: quote ? money(quote.totalCents) : <span className="font-normal text-faint">No quote</span> },
          {
            label: invoice && !invoice.sentAt ? "Invoice total, draft" : "Invoice total",
            value: invoice ? money(invoice.totalCents) : <span className="font-normal text-faint">Not invoiced</span>,
          },
          { label: !invoice ? "Margin" : invoice.marginStatus === "final" ? "True margin" : "Margin so far", value: marginValue },
        ]}
      />
    </Card>
  );
}

function LinksCard({ view }: { view: JobView }) {
  const { links } = view;
  const items = [
    links.crew && <CopyField key="crew" label="Crew link" url={links.crew} hint="Stops working once the job closes." />,
    links.invoice && <CopyField key="invoice" label="Invoice PDF" url={links.invoice} />,
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <Card title="Links">
      <div className="space-y-4">{items}</div>
    </Card>
  );
}

/** The right-hand summary: who, the card, the money, and the links to share. */
export function JobRail({ view }: { view: JobView }) {
  return (
    <>
      <CustomerCard view={view} />
      <JobCardCard view={view} />
      <MoneyCard view={view} />
      <LinksCard view={view} />
    </>
  );
}
