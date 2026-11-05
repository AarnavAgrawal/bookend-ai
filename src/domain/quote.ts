import { applyBps, computeCardLimit, laborCost } from "./money";

export type LineKind = "material" | "labor" | "other";

/** Labor lines count minutes at an hourly rate. Everything else counts units. */
export type PricedLine = {
  kind: LineKind;
  description: string;
  quantity: number;
  unitCostCents: number;
  unitSellCents: number;
  evidenceIds: string[];
  isEstimate: boolean;
};

export type PricingRates = {
  markupBps: number;
  laborCostCentsPerHour: number;
  laborBillCentsPerHour: number;
};

export type LineInput = {
  kind: LineKind;
  description: string;
  quantity: number;
  /** Ignored for labor, which always uses the org's rates. */
  unitCostCents: number;
  evidenceIds?: string[];
  isEstimate?: boolean;
};

export function priceLine(line: LineInput, rates: PricingRates): PricedLine {
  const isLabor = line.kind === "labor";
  const unitCostCents = isLabor ? rates.laborCostCentsPerHour : line.unitCostCents;
  return {
    kind: line.kind,
    description: line.description,
    quantity: line.quantity,
    unitCostCents,
    unitSellCents: isLabor
      ? rates.laborBillCentsPerHour
      : unitCostCents + applyBps(unitCostCents, rates.markupBps),
    evidenceIds: line.evidenceIds ?? [],
    isEstimate: line.isEstimate ?? false,
  };
}

export function lineCostCents(line: Pick<PricedLine, "kind" | "quantity" | "unitCostCents">) {
  return line.kind === "labor"
    ? laborCost(line.quantity, line.unitCostCents)
    : line.quantity * line.unitCostCents;
}

export function lineSellCents(line: Pick<PricedLine, "kind" | "quantity" | "unitSellCents">) {
  return line.kind === "labor"
    ? laborCost(line.quantity, line.unitSellCents)
    : line.quantity * line.unitSellCents;
}

export type QuoteTotals = {
  materialsCostCents: number;
  subtotalSellCents: number;
  taxCents: number;
  totalCents: number;
};

export function summarizeQuote(lines: readonly PricedLine[], taxRateBps: number): QuoteTotals {
  let materialsCostCents = 0;
  let subtotalSellCents = 0;
  for (const line of lines) {
    if (line.kind !== "labor") materialsCostCents += lineCostCents(line);
    subtotalSellCents += lineSellCents(line);
  }
  const taxCents = applyBps(subtotalSellCents, taxRateBps);
  return {
    materialsCostCents,
    subtotalSellCents,
    taxCents,
    totalCents: subtotalSellCents + taxCents,
  };
}

/** The median resists one odd receipt better than an average does. */
export function medianCents(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function cardLimitForQuote(
  quote: Pick<QuoteTotals, "materialsCostCents">,
  org: { taxRateBps: number; cardBufferCents: number },
): number {
  return computeCardLimit({
    materialsCents: quote.materialsCostCents,
    taxRateBps: org.taxRateBps,
    bufferCents: org.cardBufferCents,
  });
}
