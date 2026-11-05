import { desc, eq } from "drizzle-orm";
import { addPriceAction, backfillAction, importPricesAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote, money, Section, Shell } from "@/components/ui";
import { priceObservations } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

const SOURCE_LABELS = {
  ramp_receipt: "Receipt",
  ramp_merchant_data: "Ramp",
  price_book: "Price book",
  csv: "Import",
  closed_job: "Past job",
} as const;

export default async function PricesPage(props: PageProps<"/prices">) {
  const deps = await getDeps();
  const session = await requireSession(deps.db);
  const org = await loadOrg(deps.db, session.orgId);
  const { error } = await props.searchParams;
  const prices = await deps.db
    .select()
    .from(priceObservations)
    .where(eq(priceObservations.orgId, session.orgId))
    .orderBy(desc(priceObservations.observedAt))
    .limit(200);

  return (
    <Shell orgName={org.name}>
      <h1 className="text-4xl">Prices</h1>
      <p className="mt-1 mb-6 max-w-xl text-muted">
        What you&apos;ve actually paid. Quotes are priced from this, and it grows with every receipt.
      </p>
      <ErrorNote message={error} />

      <div className="grid gap-8 sm:grid-cols-2">
        <form action={addPriceAction} className="space-y-3">
          <h2 className="text-2xl">Add a price</h2>
          <label>
            Item
            <input name="item" required placeholder="50 gal water heater" />
          </label>
          <label>
            What you pay ($)
            <input name="cost" type="number" step="0.01" min="0" required />
          </label>
          <SubmitButton>Add price</SubmitButton>
        </form>
        <form action={importPricesAction} className="space-y-3">
          <h2 className="text-2xl">Import a list</h2>
          <label>
            One item per line, as item,cost
            <textarea name="csv" rows={4} placeholder={"PEX elbow 1/2in,1.85\nBall valve,12.40"} />
          </label>
          <SubmitButton>Import list</SubmitButton>
        </form>
      </div>

      {deps.ramp && (
        <form action={backfillAction} className="mt-6">
          <SubmitButton className="btn btn-quiet" pending="Reading Ramp…">
            Pull item prices from Ramp
          </SubmitButton>
        </form>
      )}

      <Section title={`${prices.length} prices on file`}>
        {prices.length === 0 ? (
          <p className="text-muted">Add a few prices above so the first quote has something to use.</p>
        ) : (
          <ul className="border-t-2 border-ink">
            {prices.map((p) => (
              <li key={p.id} className="flex justify-between gap-4 border-b border-line py-2">
                <span>
                  {p.item} <span className="text-sm text-muted">{SOURCE_LABELS[p.source]}</span>
                </span>
                <span className="money">{money(p.unitCostCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Shell>
  );
}
