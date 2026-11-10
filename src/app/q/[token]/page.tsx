import { acceptQuoteAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote, money, NotFoundNote, PublicShell, Row } from "@/components/ui";
import { lineSellCents } from "@/domain/quote";
import { getDeps } from "@/platform/deps";
import { customerOf, latestQuote, quoteFromLink } from "@/services/jobs";

const quoteDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

/** "2 × $18.13" or "1.5 h × $120.00/h", so the customer can check each line. */
const lineDetail = (line: { kind: string; quantity: number; unitSellCents: number }) =>
  line.kind === "labor"
    ? `${line.quantity / 60} h × ${money(line.unitSellCents)}/h`
    : line.quantity === 1
      ? null
      : `${line.quantity} × ${money(line.unitSellCents)}`;

export default async function QuotePage(props: PageProps<"/q/[token]">) {
  const deps = await getDeps();
  const { token } = await props.params;
  const { error } = await props.searchParams;

  const found = await quoteFromLink(deps, token);
  if (!found) {
    return <NotFoundNote title="This quote link isn't valid" detail="Ask for a new link." />;
  }
  const { quote, job, lines, org } = found;
  const current = await latestQuote(deps.db, job.id);
  const open = job.state === "quote_sent" && current?.id === quote.id;
  const customer = await customerOf(deps.db, job.customerId);
  const preparedFor = [customer?.name, customer?.address].filter(Boolean).join(", ");

  return (
    <PublicShell orgName={org.name}>
      <ErrorNote message={error} />
      <p className="text-sm text-muted">
        Quote for job #{job.jobNumber}, {quoteDate.format(quote.createdAt)}
      </p>
      <h1 className="mt-1 text-4xl">{job.title}</h1>
      {preparedFor && <p className="mt-1 text-muted">For {preparedFor}</p>}
      {job.description && <p className="mt-3 text-pretty whitespace-pre-line">{job.description}</p>}
      <div className="ticket mt-5">
        {lines.map((line) => {
          const detail = lineDetail(line);
          return (
            <Row
              key={line.id}
              label={
                <>
                  {line.description}
                  {detail && <span className="block text-sm text-muted/80 tabular-nums">{detail}</span>}
                </>
              }
              value={money(lineSellCents(line))}
            />
          );
        })}
        <div className="mt-2 border-t border-line pt-2">
          <Row label="Subtotal" value={money(quote.subtotalSellCents)} />
          <Row label="Tax" value={money(quote.taxCents)} />
          <Row label="Total" value={money(quote.totalCents)} strong />
        </div>
      </div>
      {quote.assumptions && (
        <div className="mt-4">
          <p className="text-sm font-semibold">This price assumes</p>
          <p className="mt-1 text-pretty text-muted whitespace-pre-line">{quote.assumptions}</p>
        </div>
      )}
      {open ? (
        <form action={acceptQuoteAction.bind(null, token)} className="mt-6">
          <SubmitButton className="btn btn-amber w-full">Accept this quote</SubmitButton>
        </form>
      ) : (
        <p className="mt-6 font-display text-2xl font-semibold">
          {quote.acceptedAt ? "Accepted. Thank you." : "This quote is no longer open."}
        </p>
      )}
    </PublicShell>
  );
}
