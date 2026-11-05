/**
 * The job lifecycle as a pure transition table. Every state change in the app
 * goes through this table, so an illegal jump (for example opening a card
 * before the customer accepts) cannot happen regardless of what calls it.
 */

export const JOB_STATES = [
  "draft",
  "quote_review",
  "quote_sent",
  "accepted",
  "card_opening",
  "active",
  "change_pending",
  "closing",
  "invoice_review",
  "invoiced",
  "settled",
  "cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const JOB_EVENTS = [
  "QUOTE_DRAFTED",
  "QUOTE_REVISION_REQUESTED",
  "OWNER_APPROVED_QUOTE",
  "CUSTOMER_ACCEPTED",
  "CARD_OPEN_STARTED",
  "CARD_VERIFIED",
  "OVERRUN_DETECTED",
  "CHANGE_RESOLVED",
  "CREW_DONE",
  "INVOICE_DRAFTED",
  "INVOICE_SENT",
  "SETTLED",
  "CANCELLED",
] as const;

export type JobEvent = (typeof JOB_EVENTS)[number];

const CANCELLABLE: readonly JobState[] = [
  "draft",
  "quote_review",
  "quote_sent",
  "accepted",
  "card_opening",
  "active",
  "change_pending",
];

const TRANSITIONS: Readonly<Partial<Record<JobState, Partial<Record<JobEvent, JobState>>>>> = {
  draft: { QUOTE_DRAFTED: "quote_review" },
  quote_review: {
    QUOTE_REVISION_REQUESTED: "draft",
    OWNER_APPROVED_QUOTE: "quote_sent",
  },
  quote_sent: { CUSTOMER_ACCEPTED: "accepted" },
  accepted: { CARD_OPEN_STARTED: "card_opening" },
  card_opening: { CARD_VERIFIED: "active" },
  active: { OVERRUN_DETECTED: "change_pending", CREW_DONE: "closing" },
  change_pending: { CHANGE_RESOLVED: "active" },
  closing: { INVOICE_DRAFTED: "invoice_review" },
  invoice_review: { INVOICE_SENT: "invoiced" },
  invoiced: { SETTLED: "settled" },
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: JobState,
    readonly event: JobEvent,
  ) {
    super(`Illegal job transition: ${event} from ${from}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition(from: JobState, event: JobEvent): boolean {
  if (event === "CANCELLED") return CANCELLABLE.includes(from);
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function nextState(from: JobState, event: JobEvent): JobState {
  if (event === "CANCELLED" && CANCELLABLE.includes(from)) return "cancelled";
  const to = TRANSITIONS[from]?.[event];
  if (to === undefined) throw new IllegalTransitionError(from, event);
  return to;
}
