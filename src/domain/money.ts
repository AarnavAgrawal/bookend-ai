/**
 * All money in Bookend is integer minor units (cents), matching Ramp's API.
 * Rates are basis points (825 = 8.25%). Nothing in this file touches a float
 * that is stored or sent anywhere: every result is an integer.
 */

export const NEAR_LIMIT_PERCENT = 85;

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
}

function roundDiv(numerator: number, denominator: number): number {
  assertInt(numerator, "numerator");
  // Round half away from zero so refunds mirror charges exactly.
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  return sign * Math.floor((abs + Math.floor(denominator / 2)) / denominator);
}

export function applyBps(cents: number, bps: number): number {
  assertInt(cents, "cents");
  assertInt(bps, "bps");
  return roundDiv(cents * bps, 10_000);
}

/**
 * The hard limit on a job's card. Suppliers charge sales tax on top of the
 * quoted materials, so a limit of exactly the materials cost would decline a
 * purchase that is on budget.
 */
export function computeCardLimit(input: {
  materialsCents: number;
  taxRateBps: number;
  bufferCents: number;
}): number {
  const { materialsCents, taxRateBps, bufferCents } = input;
  assertInt(materialsCents, "materialsCents");
  assertInt(bufferCents, "bufferCents");
  if (materialsCents < 0 || bufferCents < 0 || taxRateBps < 0) {
    throw new RangeError("card limit inputs must not be negative");
  }
  return materialsCents + applyBps(materialsCents, taxRateBps) + bufferCents;
}

/** Ramp transaction states, minus the `ALL` query-only value. */
export type RampTxnState =
  | "CLEARED"
  | "COMPLETION"
  | "DECLINED"
  | "ERROR"
  | "PENDING"
  | "PENDING_INITIATION";

export type SpendTxn = { state: RampTxnState; amountCents: number };

const SETTLED_STATES: ReadonlySet<RampTxnState> = new Set(["CLEARED", "COMPLETION"]);
const PENDING_STATES: ReadonlySet<RampTxnState> = new Set(["PENDING", "PENDING_INITIATION"]);

export type SpendSummary = {
  settledCents: number;
  pendingCents: number;
  committedCents: number;
  remainingCents: number;
  nearLimit: boolean;
};

export function summarizeSpend(txns: readonly SpendTxn[], limitCents: number): SpendSummary {
  assertInt(limitCents, "limitCents");
  let settledCents = 0;
  let pendingCents = 0;
  for (const { state, amountCents } of txns) {
    assertInt(amountCents, "amountCents");
    if (SETTLED_STATES.has(state)) settledCents += amountCents;
    else if (PENDING_STATES.has(state)) pendingCents += amountCents;
  }
  const committedCents = settledCents + pendingCents;
  return {
    settledCents,
    pendingCents,
    committedCents,
    remainingCents: Math.max(0, limitCents - committedCents),
    nearLimit: committedCents * 100 >= limitCents * NEAR_LIMIT_PERCENT,
  };
}

/** Code, never the model, decides the new limit after a declined purchase. */
export function computeLimitIncrease(input: {
  currentLimitCents: number;
  committedCents: number;
  declinedCents: number;
}): { increaseCents: number; newLimitCents: number } {
  const { currentLimitCents, committedCents, declinedCents } = input;
  assertInt(currentLimitCents, "currentLimitCents");
  assertInt(committedCents, "committedCents");
  assertInt(declinedCents, "declinedCents");
  const required = committedCents + declinedCents;
  const increaseCents = Math.max(0, required - currentLimitCents);
  return { increaseCents, newLimitCents: currentLimitCents + increaseCents };
}

export function laborCost(minutes: number, hourlyCostCents: number): number {
  assertInt(minutes, "minutes");
  assertInt(hourlyCostCents, "hourlyCostCents");
  return roundDiv(minutes * hourlyCostCents, 60);
}

export type Margin = {
  totalCostCents: number;
  marginCents: number;
  /** Null when there is no revenue to divide by. */
  marginBps: number | null;
};

export function computeMargin(input: {
  revenueCents: number;
  materialsCents: number;
  laborCents: number;
  manualCostsCents: number;
}): Margin {
  const { revenueCents, materialsCents, laborCents, manualCostsCents } = input;
  assertInt(revenueCents, "revenueCents");
  const totalCostCents = materialsCents + laborCents + manualCostsCents;
  assertInt(totalCostCents, "totalCostCents");
  const marginCents = revenueCents - totalCostCents;
  return {
    totalCostCents,
    marginCents,
    marginBps: revenueCents === 0 ? null : roundDiv(marginCents * 10_000, revenueCents),
  };
}
