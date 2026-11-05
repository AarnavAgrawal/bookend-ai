import { describe, expect, it } from "vitest";
import {
  JOB_EVENTS,
  JOB_STATES,
  IllegalTransitionError,
  canTransition,
  nextState,
  type JobEvent,
  type JobState,
} from "./transition";

const LEGAL: Array<[JobState, JobEvent, JobState]> = [
  ["draft", "QUOTE_DRAFTED", "quote_review"],
  ["quote_review", "QUOTE_REVISION_REQUESTED", "draft"],
  ["quote_review", "OWNER_APPROVED_QUOTE", "quote_sent"],
  ["quote_sent", "CUSTOMER_ACCEPTED", "accepted"],
  ["accepted", "CARD_OPEN_STARTED", "card_opening"],
  ["card_opening", "CARD_VERIFIED", "active"],
  ["active", "OVERRUN_DETECTED", "change_pending"],
  ["change_pending", "CHANGE_RESOLVED", "active"],
  ["active", "CREW_DONE", "closing"],
  ["closing", "INVOICE_DRAFTED", "invoice_review"],
  ["invoice_review", "INVOICE_SENT", "invoiced"],
  ["invoiced", "SETTLED", "settled"],
  ["draft", "CANCELLED", "cancelled"],
  ["quote_review", "CANCELLED", "cancelled"],
  ["quote_sent", "CANCELLED", "cancelled"],
  ["accepted", "CANCELLED", "cancelled"],
  ["card_opening", "CANCELLED", "cancelled"],
  ["active", "CANCELLED", "cancelled"],
  ["change_pending", "CANCELLED", "cancelled"],
];

describe("job state machine", () => {
  it.each(LEGAL)("%s + %s -> %s", (from, event, to) => {
    expect(nextState(from, event)).toBe(to);
    expect(canTransition(from, event)).toBe(true);
  });

  it("rejects every pair that is not explicitly legal", () => {
    const legal = new Set(LEGAL.map(([from, event]) => `${from}:${event}`));
    let checked = 0;
    for (const from of JOB_STATES) {
      for (const event of JOB_EVENTS) {
        if (legal.has(`${from}:${event}`)) continue;
        checked += 1;
        expect(canTransition(from, event)).toBe(false);
        expect(() => nextState(from, event)).toThrow(IllegalTransitionError);
      }
    }
    expect(checked).toBe(JOB_STATES.length * JOB_EVENTS.length - LEGAL.length);
  });

  it("cannot open a card before the customer accepts", () => {
    expect(canTransition("quote_review", "CARD_OPEN_STARTED")).toBe(false);
    expect(canTransition("quote_sent", "CARD_OPEN_STARTED")).toBe(false);
  });

  it("cannot close while a change order is pending", () => {
    expect(canTransition("change_pending", "CREW_DONE")).toBe(false);
  });

  it("cannot cancel once closing has started", () => {
    for (const from of ["closing", "invoice_review", "invoiced", "settled"] as const) {
      expect(canTransition(from, "CANCELLED")).toBe(false);
    }
  });

  it("treats settled and cancelled as terminal", () => {
    for (const event of JOB_EVENTS) {
      expect(canTransition("settled", event)).toBe(false);
      expect(canTransition("cancelled", event)).toBe(false);
    }
  });
});
