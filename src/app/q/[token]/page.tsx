import { acceptQuoteAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote, money, NotFoundNote, PublicShell, Row } from "@/components/ui";
import { lineSellCents } from "@/domain/quote";
import { getDeps } from "@/platform/deps";
import { latestQuote, quoteFromLink } from "@/services/jobs";

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

  return (
    <PublicShell orgName={org.name}>
      <ErrorNote message={error} />
      <h1 className="mb-4 text-4xl">{job.title}</h1>
      <div className="ticket">
        {lines.map((line) => (
          <Row key={line.id} label={line.description} value={money(lineSellCents(line))} />
        ))}
        <div className="mt-2 border-t border-line pt-2">
          <Row label="Subtotal" value={money(quote.subtotalSellCents)} />
          <Row label="Tax" value={money(quote.taxCents)} />
          <Row label="Total" value={money(quote.totalCents)} strong />
        </div>
      </div>
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
