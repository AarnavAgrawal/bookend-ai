import { and, count, desc, eq, ilike } from "drizzle-orm";
import Link from "next/link";
import {
  addPriceAction,
  backfillAction,
  importPricesAction,
  loadSamplePricesAction,
} from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { Field, FormError, FormFooter, UnitInput } from "@/components/app/forms";
import { DesktopOnly, MobileList, SearchBox, shortDate } from "@/components/app/lists";
import { Badge, Card, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { money } from "@/components/ui";
import { priceObservations } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

type Source = (typeof priceObservations.$inferSelect)["source"];

const SOURCES: Record<Source, { label: string; tone: "info" | "neutral" | "muted" | "success" | "accent" }> = {
  ramp_receipt: { label: "Receipt", tone: "info" },
  ramp_merchant_data: { label: "Ramp", tone: "info" },
  price_book: { label: "Price book", tone: "neutral" },
  csv: { label: "Imported", tone: "muted" },
  closed_job: { label: "Past job", tone: "success" },
};

const LIMIT = 200;

export default async function PricesPage(props: PageProps<"/prices">) {
  const deps = await getDeps();
  const session = await requireSession(deps.db);
  const org = await loadOrg(deps.db, session.orgId);
  const params = await props.searchParams;
  const error = params.error;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const panel = params.add !== undefined ? "add" : params.import !== undefined ? "import" : null;
  const now = new Date();

  const scope = eq(priceObservations.orgId, session.orgId);
  const where = query ? and(scope, ilike(priceObservations.item, `%${query.replace(/[\\%_]/g, "\\$&")}%`)) : scope;
  const [{ total }] = await deps.db.select({ total: count() }).from(priceObservations).where(scope);
  const [{ matching }] = await deps.db.select({ matching: count() }).from(priceObservations).where(where);
  const prices = await deps.db
    .select()
    .from(priceObservations)
    .where(where)
    .orderBy(desc(priceObservations.observedAt), priceObservations.item)
    .limit(LIMIT);

  const keepQuery = query ? `&q=${encodeURIComponent(query)}` : "";
  const closeHref = query ? `/prices?q=${encodeURIComponent(query)}` : "/prices";

  return (
    <AppShell orgName={org.name} wide>
      <PageHeader
        title="Price book"
        description="What you actually pay for parts. Quotes cite these prices, and every receipt adds to them."
        actions={
          <>
            {deps.ramp && (
              <form action={backfillAction}>
                <SubmitButton className="ui-btn ui-btn-ghost" pending="Reading Ramp…">
                  {/* One text node: the button's flex gap would otherwise space out each piece. */}
                  <span>
                    Pull <span className="hidden sm:inline">item prices </span>from Ramp
                  </span>
                </SubmitButton>
              </form>
            )}
            <Link href={`/prices?import${keepQuery}`} className="ui-btn ui-btn-secondary" scroll={false}>
              Import CSV
            </Link>
            <Link href={`/prices?add${keepQuery}`} className="ui-btn ui-btn-primary" scroll={false}>
              Add price
            </Link>
          </>
        }
      />
      <FormError message={error} />

      {panel === "add" && (
        <form action={addPriceAction} className="mb-4 rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">Add a price</h2>
            <p className="text-xs text-muted">One item at what you pay your supplier, before markup.</p>
          </div>
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:px-5">
            <Field label="Item" htmlFor="item">
              <input id="item" name="item" required placeholder="50 gal water heater" autoFocus autoComplete="off" />
            </Field>
            <Field label="Unit cost" htmlFor="cost">
              <UnitInput unit="$" id="cost" name="cost" type="number" step="0.01" min="0.01" required placeholder="0.00" />
            </Field>
          </div>
          <FormFooter>
            <Link href={closeHref} className="ui-btn ui-btn-secondary ui-btn-sm" scroll={false}>
              Cancel
            </Link>
            <SubmitButton className="ui-btn ui-btn-primary ui-btn-sm" pending="Adding…">
              Add price
            </SubmitButton>
          </FormFooter>
        </form>
      )}

      {panel === "import" && (
        <form action={importPricesAction} className="mb-4 rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">Import prices</h2>
            <p className="text-xs text-muted">Paste a list from a spreadsheet or a supplier export.</p>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <Field label="Prices" htmlFor="csv" help="One item per line, as item,cost. Costs are in dollars.">
              <textarea
                id="csv"
                name="csv"
                rows={5}
                required
                className="font-mono text-[13px]"
                placeholder={"PEX elbow 1/2in,1.85\nBall valve,12.40"}
              />
            </Field>
          </div>
          <FormFooter>
            <Link href={closeHref} className="ui-btn ui-btn-secondary ui-btn-sm" scroll={false}>
              Cancel
            </Link>
            <SubmitButton className="ui-btn ui-btn-primary ui-btn-sm" pending="Importing…">
              Import prices
            </SubmitButton>
          </FormFooter>
        </form>
      )}

      <Card
        flush
        title={
          query
            ? `${matching} of ${total} ${total === 1 ? "price" : "prices"}`
            : `${total} ${total === 1 ? "price" : "prices"}`
        }
        description={matching > LIMIT ? `Showing the ${LIMIT} most recent. Search to narrow the list.` : undefined}
        actions={total > 0 ? <SearchBox action="/prices" value={query} label="Search prices" placeholder="Search items" /> : undefined}
      >
        {total === 0 ? (
          <EmptyState
            title="No prices yet"
            description="Prices you add, import or pull from Ramp receipts show up here, and the first quote cites them. Sample prices cover plumbing, electrical and catering, and you can replace them any time."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <form action={loadSamplePricesAction}>
                  <SubmitButton className="ui-btn ui-btn-secondary ui-btn-sm" pending="Loading…">
                    Load sample prices
                  </SubmitButton>
                </form>
                <Link href="/prices?add" className="ui-btn ui-btn-primary ui-btn-sm" scroll={false}>
                  Add price
                </Link>
              </div>
            }
          />
        ) : prices.length === 0 ? (
          <EmptyState
            title={`No prices match “${query}”`}
            description="Try a shorter word, like “valve” or “breaker”."
            action={
              <Link href="/prices" className="ui-btn ui-btn-secondary ui-btn-sm">
                Clear search
              </Link>
            }
          />
        ) : (
          <>
            <MobileList>
              {prices.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{p.item}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone={SOURCES[p.source].tone}>{SOURCES[p.source].label}</Badge>
                      <span className="text-xs text-faint">{shortDate(p.observedAt, now)}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums">{money(p.unitCostCents)}</span>
                </li>
              ))}
            </MobileList>
            <DesktopOnly>
              <Table minWidth="40rem">
                <THead>
                  <TH>Item</TH>
                  <TH className="w-40">Source</TH>
                  <TH align="right" className="w-32">
                    Unit cost
                  </TH>
                  <TH align="right" className="w-32">
                    Added
                  </TH>
                </THead>
                <TBody>
                  {prices.map((p) => (
                    <TR key={p.id}>
                      <TD className="font-medium">{p.item}</TD>
                      <TD>
                        <Badge tone={SOURCES[p.source].tone}>{SOURCES[p.source].label}</Badge>
                      </TD>
                      <TD align="right">{money(p.unitCostCents)}</TD>
                      <TD align="right" className="text-muted">
                        <time dateTime={p.observedAt.toISOString()}>{shortDate(p.observedAt, now)}</time>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </DesktopOnly>
          </>
        )}
      </Card>
    </AppShell>
  );
}
