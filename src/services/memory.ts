import { createHash } from "node:crypto";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobFunds, priceObservations } from "@/db/schema";
import type { RampClient } from "@/ramp/client";

type Source = (typeof priceObservations.$inferInsert)["source"];

export type Observation = {
  orgId: string;
  item: string;
  unitCostCents: number;
  source: Source;
  sourceId: string;
  observedAt: Date;
};

/** Safe to repeat: the same record from the same source is stored once. */
export async function recordObservations(db: Db, rows: Observation[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(priceObservations).values(rows).onConflictDoNothing();
}

export async function addPriceBookItem(
  db: Db,
  input: { orgId: string; item: string; unitCostCents: number; now?: Date },
): Promise<void> {
  const observedAt = input.now ?? new Date();
  await recordObservations(db, [
    {
      orgId: input.orgId,
      item: input.item,
      unitCostCents: input.unitCostCents,
      source: "price_book",
      sourceId: `${input.item.toLowerCase()}@${observedAt.toISOString()}`,
      observedAt,
    },
  ]);
}

/**
 * Typical supplier prices to try the product with. They go in the price book
 * like any entry the owner adds, so they are labelled and easy to replace.
 */
export const SAMPLE_PRICES: ReadonlyArray<{ item: string; unitCostCents: number }> = [
  { item: "50 gal gas water heater", unitCostCents: 90_000 },
  { item: "40 gal electric water heater", unitCostCents: 62_000 },
  { item: "Water heater flue pipe kit", unitCostCents: 25_000 },
  { item: "Gas flex connector 24in", unitCostCents: 2_400 },
  { item: "Copper pipe 3/4in 10ft", unitCostCents: 4_800 },
  { item: "PEX tubing 1/2in 100ft", unitCostCents: 5_200 },
  { item: "Ball valve 3/4in", unitCostCents: 1_850 },
  { item: "Expansion tank 2 gal", unitCostCents: 5_600 },
  { item: "Toilet wax ring", unitCostCents: 650 },
  { item: "20A breaker", unitCostCents: 1_200 },
  { item: "GFCI outlet", unitCostCents: 2_200 },
  { item: "12/2 Romex 250ft", unitCostCents: 13_500 },
  { item: "Catering lunch per head", unitCostCents: 1_400 },
  { item: "Chafing dish fuel 72 pack", unitCostCents: 6_900 },
  { item: "Disposable plates 500 count", unitCostCents: 5_400 },
];

export async function loadSamplePrices(db: Db, orgId: string): Promise<number> {
  const observedAt = new Date();
  await recordObservations(
    db,
    SAMPLE_PRICES.map((p) => ({
      orgId,
      item: p.item,
      unitCostCents: p.unitCostCents,
      source: "price_book" as const,
      sourceId: `sample:${p.item}`,
      observedAt,
    })),
  );
  return SAMPLE_PRICES.length;
}

/** Parses `item,cost` rows, with the cost in dollars. Returns how many were kept. */
export function parsePriceCsv(csv: string): Array<{ item: string; unitCostCents: number }> {
  return csv.split(/\r?\n/).flatMap((line) => {
    const comma = line.lastIndexOf(",");
    if (comma < 1) return [];
    const item = line.slice(0, comma).trim().replace(/^"|"$/g, "");
    const dollars = Number(line.slice(comma + 1).trim().replace(/^\$/, ""));
    if (!item || !Number.isFinite(dollars) || dollars <= 0) return [];
    return [{ item, unitCostCents: Math.round(dollars * 100) }];
  });
}

export async function importPriceCsv(
  db: Db,
  input: { orgId: string; csv: string; now?: Date },
): Promise<number> {
  const rows = parsePriceCsv(input.csv);
  const observedAt = input.now ?? new Date();
  await recordObservations(
    db,
    rows.map((row) => ({
      orgId: input.orgId,
      item: row.item,
      unitCostCents: row.unitCostCents,
      source: "csv" as const,
      sourceId: createHash("sha256").update(`${row.item}:${row.unitCostCents}`).digest("hex"),
      observedAt,
    })),
  );
  return rows.length;
}

/** Org-scoped by construction: `orgId` is required and the query always filters on it. */
export async function searchPrices(db: Db, orgId: string, query: string, limit = 15) {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/[%_\\]/g, ""))
    .filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  return db
    .select({
      id: priceObservations.id,
      item: priceObservations.item,
      unitCostCents: priceObservations.unitCostCents,
      source: priceObservations.source,
      observedAt: priceObservations.observedAt,
    })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.orgId, orgId),
        or(...terms.map((term) => ilike(priceObservations.item, `%${term}%`))),
      ),
    )
    .orderBy(desc(priceObservations.observedAt))
    .limit(limit);
}

/**
 * Pulls item-level prices from this org's own funds only. In a shared sandbox
 * the rest of the business's spend belongs to other tenants, so it never counts.
 */
export async function backfillFromRamp(db: Db, ramp: RampClient, orgId: string): Promise<number> {
  const funds = await db
    .select({ rampFundId: jobFunds.rampFundId })
    .from(jobFunds)
    .where(eq(jobFunds.orgId, orgId));

  let count = 0;
  for (const { rampFundId } of funds) {
    for (const txn of await ramp.listFundTransactions(rampFundId)) {
      const rows = txn.receiptItems.map((item) => ({
        orgId,
        item: item.description,
        unitCostCents: item.unitCostCents,
        source: "ramp_merchant_data" as const,
        sourceId: txn.id,
        observedAt: txn.occurredAt ?? new Date(),
      }));
      await recordObservations(db, rows);
      count += rows.length;
    }
  }
  return count;
}
