import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cardLimitForQuote,
  lineCostCents,
  lineSellCents,
  medianCents,
  priceLine,
  summarizeQuote,
} from "./quote";

const rates = { markupBps: 2_500, laborCostCentsPerHour: 4_000, laborBillCentsPerHour: 12_000 };

describe("priceLine", () => {
  it("marks up a material from its cost", () => {
    const line = priceLine(
      { kind: "material", description: "Heater", quantity: 1, unitCostCents: 72_000 },
      rates,
    );
    expect(line).toMatchObject({ unitCostCents: 72_000, unitSellCents: 90_000 });
  });

  it("takes labor rates from settings, not from the input", () => {
    const line = priceLine(
      { kind: "labor", description: "Install", quantity: 90, unitCostCents: 1 },
      rates,
    );
    expect(line).toMatchObject({ unitCostCents: 4_000, unitSellCents: 12_000 });
    expect(lineCostCents(line)).toBe(6_000);
    expect(lineSellCents(line)).toBe(18_000);
  });
});

describe("summarizeQuote", () => {
  it("leaves labor out of the materials total the card is based on", () => {
    const lines = [
      priceLine({ kind: "material", description: "A", quantity: 2, unitCostCents: 100 }, rates),
      priceLine({ kind: "other", description: "Permit", quantity: 1, unitCostCents: 50 }, rates),
      priceLine({ kind: "labor", description: "L", quantity: 60, unitCostCents: 0 }, rates),
    ];
    expect(summarizeQuote(lines, 1_000)).toEqual({
      materialsCostCents: 250,
      subtotalSellCents: 12_313,
      taxCents: 1_231,
      totalCents: 13_544,
    });
  });

  it("always totals to the subtotal plus tax, in whole cents", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            quantity: fc.integer({ min: 1, max: 500 }),
            unitCostCents: fc.integer({ min: 0, max: 1_000_000 }),
          }),
        ),
        fc.integer({ min: 0, max: 2_000 }),
        (rows, taxRateBps) => {
          const lines = rows.map((r) =>
            priceLine({ kind: "material", description: "x", ...r }, rates),
          );
          const totals = summarizeQuote(lines, taxRateBps);
          expect(totals.totalCents).toBe(totals.subtotalSellCents + totals.taxCents);
          expect(Number.isInteger(totals.taxCents)).toBe(true);
        },
      ),
    );
  });
});

describe("medianCents", () => {
  it("resists one odd receipt", () => {
    expect(medianCents([70_000, 72_000, 500_000])).toBe(72_000);
  });

  it("averages the middle two", () => {
    expect(medianCents([100, 201])).toBe(151);
  });

  it("has no answer for no evidence", () => {
    expect(medianCents([])).toBeNull();
  });
});

describe("cardLimitForQuote", () => {
  it("covers sales tax and the owner's buffer", () => {
    expect(
      cardLimitForQuote({ materialsCostCents: 90_000 }, { taxRateBps: 800, cardBufferCents: 1_000 }),
    ).toBe(98_200);
  });
});
