import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyBps,
  computeCardLimit,
  computeLimitIncrease,
  computeMargin,
  laborCost,
  summarizeSpend,
  type SpendTxn,
} from "./money";

const cents = fc.integer({ min: 0, max: 100_000_000 });
const bps = fc.integer({ min: 0, max: 2_500 });

describe("applyBps", () => {
  it("rounds half up", () => {
    expect(applyBps(100, 825)).toBe(8); // 8.25 -> 8
    expect(applyBps(200, 825)).toBe(17); // 16.5 -> 17
    expect(applyBps(90_000, 825)).toBe(7_425);
  });

  it("rejects non-integer money", () => {
    expect(() => applyBps(10.5, 100)).toThrow();
    expect(() => applyBps(100, 1.5)).toThrow();
  });
});

describe("computeCardLimit", () => {
  it("covers materials plus estimated tax plus buffer", () => {
    expect(
      computeCardLimit({ materialsCents: 90_000, taxRateBps: 825, bufferCents: 0 }),
    ).toBe(97_425);
    expect(
      computeCardLimit({ materialsCents: 90_000, taxRateBps: 0, bufferCents: 5_000 }),
    ).toBe(95_000);
  });

  it("never falls below the quoted materials", () => {
    fc.assert(
      fc.property(cents, bps, cents, (materialsCents, taxRateBps, bufferCents) => {
        const limit = computeCardLimit({ materialsCents, taxRateBps, bufferCents });
        expect(limit).toBeGreaterThanOrEqual(materialsCents + bufferCents);
        expect(Number.isSafeInteger(limit)).toBe(true);
      }),
    );
  });
});

const txn = (state: SpendTxn["state"], amountCents: number): SpendTxn => ({
  state,
  amountCents,
});

describe("summarizeSpend", () => {
  it("counts pending and cleared spend and ignores declines", () => {
    const s = summarizeSpend(
      [txn("CLEARED", 40_000), txn("PENDING", 20_000), txn("DECLINED", 99_000)],
      100_000,
    );
    expect(s.committedCents).toBe(60_000);
    expect(s.settledCents).toBe(40_000);
    expect(s.pendingCents).toBe(20_000);
    expect(s.remainingCents).toBe(40_000);
    expect(s.nearLimit).toBe(false);
  });

  it("nets refunds against spend", () => {
    const s = summarizeSpend([txn("CLEARED", 50_000), txn("CLEARED", -10_000)], 100_000);
    expect(s.committedCents).toBe(40_000);
  });

  it("flags near-limit at exactly 85 percent", () => {
    expect(summarizeSpend([txn("CLEARED", 84_999)], 100_000).nearLimit).toBe(false);
    expect(summarizeSpend([txn("CLEARED", 85_000)], 100_000).nearLimit).toBe(true);
  });

  it("does not report negative remaining", () => {
    expect(summarizeSpend([txn("CLEARED", 120_000)], 100_000).remainingCents).toBe(0);
  });

  it("is independent of transaction order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            state: fc.constantFrom<SpendTxn["state"]>(
              "CLEARED",
              "PENDING",
              "DECLINED",
              "ERROR",
              "COMPLETION",
              "PENDING_INITIATION",
            ),
            amountCents: fc.integer({ min: -100_000, max: 100_000 }),
          }),
        ),
        cents,
        (txns, limit) => {
          const reversed = [...txns].reverse();
          expect(summarizeSpend(reversed, limit)).toEqual(summarizeSpend(txns, limit));
        },
      ),
    );
  });
});

describe("computeLimitIncrease", () => {
  it("raises the limit just enough for the declined purchase to clear", () => {
    const r = computeLimitIncrease({
      currentLimitCents: 90_000,
      committedCents: 80_000,
      declinedCents: 25_000,
    });
    expect(r.increaseCents).toBe(15_000);
    expect(r.newLimitCents).toBe(105_000);
  });

  it("does nothing when the purchase already fits", () => {
    const r = computeLimitIncrease({
      currentLimitCents: 90_000,
      committedCents: 10_000,
      declinedCents: 25_000,
    });
    expect(r.increaseCents).toBe(0);
    expect(r.newLimitCents).toBe(90_000);
  });

  it("always leaves room for the retry", () => {
    fc.assert(
      fc.property(cents, cents, cents, (currentLimitCents, committedCents, declinedCents) => {
        const r = computeLimitIncrease({ currentLimitCents, committedCents, declinedCents });
        expect(r.newLimitCents).toBeGreaterThanOrEqual(committedCents + declinedCents);
        expect(r.newLimitCents).toBeGreaterThanOrEqual(currentLimitCents);
      }),
    );
  });
});

describe("laborCost", () => {
  it("prices minutes at an hourly cost rate", () => {
    expect(laborCost(90, 4_000)).toBe(6_000);
    expect(laborCost(1, 100)).toBe(2); // 1.67 -> 2
  });
});

describe("computeMargin", () => {
  it("reports the true margin from revenue and all costs", () => {
    const m = computeMargin({
      revenueCents: 180_000,
      materialsCents: 95_000,
      laborCents: 40_000,
      manualCostsCents: 5_000,
    });
    expect(m.totalCostCents).toBe(140_000);
    expect(m.marginCents).toBe(40_000);
    expect(m.marginBps).toBe(2_222);
  });

  it("handles a loss", () => {
    const m = computeMargin({
      revenueCents: 100_000,
      materialsCents: 120_000,
      laborCents: 0,
      manualCostsCents: 0,
    });
    expect(m.marginCents).toBe(-20_000);
    expect(m.marginBps).toBe(-2_000);
  });

  it("returns no percentage when there is no revenue", () => {
    const m = computeMargin({
      revenueCents: 0,
      materialsCents: 1,
      laborCents: 0,
      manualCostsCents: 0,
    });
    expect(m.marginBps).toBeNull();
  });
});
