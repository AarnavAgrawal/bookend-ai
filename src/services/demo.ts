import { and, eq, sql, type AnyColumn } from "drizzle-orm";
import { priceProposal, type QuoteProposal } from "@/ai/quote-agent";
import type { Db } from "@/db/client";
import {
  approvals,
  changeOrders,
  customers,
  invoices,
  jobEvents,
  jobFunds,
  jobs,
  laborEntries,
  orgs,
  outboxMessages,
  priceObservations,
  quotes,
  rampConnections,
  rampOperations,
  transactions,
  voiceNotes,
} from "@/db/schema";
import type { LineInput } from "@/domain/quote";
import type { Deps } from "@/platform/deps";
import { LocalMailer } from "@/platform/email";
import { FakeRamp } from "@/ramp/fake";
import { addVoiceNote, closeJob, recordPayment, sendInvoice } from "./closeout";
import { explainChangeOrder, simulatePurchase } from "./field";
import {
  acceptQuoteFromLink,
  changeOrderUrl,
  confirmApproval,
  connectRamp,
  createJob,
  loadOrg,
  NotAllowedError,
  requestCard,
  requestRaise,
  respondToChangeOrder,
  saveQuote,
  sendQuoteToCustomer,
} from "./jobs";
import { loadSamplePrices } from "./memory";

/*
 * A plumbing business a few weeks in, so someone trying Bookend sees every part
 * of it at once. Nothing is written directly: each job goes through the same
 * services the buttons call, so every total, limit and margin is computed the
 * way a real one would be.
 *
 * Paid jobs run their cards against an in-memory Ramp, since those cards are
 * closed and never touched again. Open jobs get real sandbox cards, so the
 * buttons on them (raise a limit, freeze, close) work against Ramp.
 */

type Seed = Deps;

type Material = { item: string; quantity: number };
type Estimate = { description: string; quantity: number; unitCostCents: number };

const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

/** Typical rates for a small plumbing shop, used only when the owner hasn't set any. */
const DEMO_RATES = {
  markupBps: 2_500,
  taxRateBps: 825,
  laborCostCentsPerHour: 4_500,
  laborBillCentsPerHour: 12_500,
};

/** Quote lines priced from this org's own records, by the same code that prices Claude's drafts. */
async function linesFromMemory(
  db: Db,
  orgId: string,
  materials: Material[],
  laborMinutes: number,
  estimates: Estimate[] = [],
): Promise<LineInput[]> {
  const proposal: QuoteProposal = { lines: [], assumptions: "" };
  for (const m of materials) {
    const records = await db
      .select({ id: priceObservations.id })
      .from(priceObservations)
      .where(and(eq(priceObservations.orgId, orgId), sql`lower(${priceObservations.item}) = lower(${m.item})`));
    proposal.lines.push({
      kind: "material",
      description: m.item,
      quantity: m.quantity,
      evidence_ids: records.map((r) => r.id),
      estimated_unit_cost_cents: null,
    });
  }
  for (const e of estimates) {
    proposal.lines.push({
      kind: "material",
      description: e.description,
      quantity: e.quantity,
      evidence_ids: [],
      estimated_unit_cost_cents: e.unitCostCents,
    });
  }
  proposal.lines.push({
    kind: "labor",
    description: "Labor",
    quantity: laborMinutes,
    evidence_ids: [],
    estimated_unit_cost_cents: null,
  });
  return priceProposal(db, orgId, proposal);
}

/** Moves one job's whole history back in time, so the demo reads like past weeks. */
async function backdate(db: Db, jobId: string, hours: number) {
  const by = `${hours} hours`;
  const back = (column: AnyColumn) => sql`${column} - ${by}::interval`;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  await db.update(jobs).set({ createdAt: back(jobs.createdAt), updatedAt: back(jobs.updatedAt) }).where(eq(jobs.id, jobId));
  if (job.customerId) {
    await db.update(customers).set({ createdAt: back(customers.createdAt) }).where(eq(customers.id, job.customerId));
  }
  await db
    .update(quotes)
    .set({ createdAt: back(quotes.createdAt), acceptedAt: back(quotes.acceptedAt) })
    .where(eq(quotes.jobId, jobId));
  await db
    .update(transactions)
    .set({ occurredAt: back(transactions.occurredAt), updatedAt: back(transactions.updatedAt) })
    .where(eq(transactions.jobId, jobId));
  await db
    .update(invoices)
    .set({ createdAt: back(invoices.createdAt), sentAt: back(invoices.sentAt), paidAt: back(invoices.paidAt) })
    .where(eq(invoices.jobId, jobId));
  await db.update(jobEvents).set({ createdAt: back(jobEvents.createdAt) }).where(eq(jobEvents.jobId, jobId));
  await db.update(changeOrders).set({ createdAt: back(changeOrders.createdAt) }).where(eq(changeOrders.jobId, jobId));
  await db.update(voiceNotes).set({ createdAt: back(voiceNotes.createdAt) }).where(eq(voiceNotes.jobId, jobId));
  await db.update(laborEntries).set({ createdAt: back(laborEntries.createdAt) }).where(eq(laborEntries.jobId, jobId));
  await db
    .update(jobFunds)
    .set({ createdAt: back(jobFunds.createdAt), limitChangedAt: back(jobFunds.limitChangedAt) })
    .where(eq(jobFunds.jobId, jobId));
  await db.update(approvals).set({ createdAt: back(approvals.createdAt) }).where(eq(approvals.jobId, jobId));
  await db.update(rampOperations).set({ createdAt: back(rampOperations.createdAt) }).where(eq(rampOperations.jobId, jobId));
  await db.update(outboxMessages).set({ createdAt: back(outboxMessages.createdAt) }).where(eq(outboxMessages.jobId, jobId));
  await db
    .update(priceObservations)
    .set({ observedAt: back(priceObservations.observedAt) })
    .where(and(eq(priceObservations.source, "closed_job"), eq(priceObservations.sourceId, jobId)));
}

type JobPlan = {
  title: string;
  description: string;
  customer: { name: string; email: string; address: string };
};

async function quoted(deps: Seed, orgId: string, plan: JobPlan, lines: LineInput[], assumptions: string) {
  const job = await createJob(deps.db, { orgId, ...plan });
  await saveQuote(deps.db, { orgId, jobId: job.id, lines, assumptions, draftedBy: "owner", actor: "owner" });
  return job;
}

/** Sent, accepted from the customer's link, and a card opened through the approval path. */
async function withCard(deps: Seed, orgId: string, jobId: string) {
  const { url } = await sendQuoteToCustomer(deps, { orgId, jobId, expectedVersion: 1, actor: "owner" });
  await acceptQuoteFromLink(deps, tokenOf(url));
  const card = await requestCard(deps, { orgId, jobId });
  const status = await confirmApproval(deps, { token: tokenOf(card.url), approvedBy: "owner" });
  if (status !== "succeeded") throw new Error("The demo card didn't open");
  return card.limitCents;
}

const buy = (db: Db, orgId: string, jobId: string, merchantName: string, amountCents: number) =>
  simulatePurchase(db, { orgId, jobId, merchantName, amountCents });

async function finishWork(deps: Seed, orgId: string, jobId: string, note: string, minutes: number) {
  const voice = await addVoiceNote(deps, { orgId, jobId, typedNote: note, actor: "crew" });
  await closeJob(deps, { orgId, jobId, noteId: voice.id, transcript: note, minutes, actor: "crew" });
}

const materialsOf = async (db: Db, jobId: string) => {
  const [quote] = await db.select().from(quotes).where(eq(quotes.jobId, jobId));
  return quote.materialsCostCents;
};

export async function loadDemoBusiness(deps: Deps, orgId: string) {
  const { db } = deps;
  const [existing] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.orgId, orgId)).limit(1);
  if (existing) throw new NotAllowedError("The demo loads into an empty business. This one already has jobs.");

  const [connection] = await db.select().from(rampConnections).where(eq(rampConnections.orgId, orgId));
  if (connection?.mode === "production") {
    throw new NotAllowedError("Demo data is for sandbox businesses only.");
  }

  // Nothing here should email anyone: messages wait on the Messages page.
  const base: Seed = { ...deps, claude: null, transcriber: null, mailer: new LocalMailer() };
  const live: Seed = { ...base, ramp: deps.ramp ?? new FakeRamp() };
  const history: Seed = { ...base, ramp: new FakeRamp() };
  if (!connection) await connectRamp(live, { orgId });

  const org = await loadOrg(db, orgId);
  if (org.markupBps === 0 && org.taxRateBps === 0 && org.laborBillCentsPerHour === 0) {
    await db.update(orgs).set(DEMO_RATES).where(eq(orgs.id, orgId));
  }
  await loadSamplePrices(db, orgId);

  /* Paid jobs: the history the open jobs' quotes draw on. */

  const heater = await quoted(
    history,
    orgId,
    {
      title: "Replace 50 gal gas water heater",
      description: "Old tank is leaking at the base. Basement install, gas line already in place.",
      customer: { name: "Dana Reyes", email: "dana.reyes@example.com", address: "12 Elm St" },
    },
    [
      { kind: "material", description: "50 gal gas water heater", quantity: 1, unitCostCents: 87_500 },
      { kind: "material", description: "Gas flex connector 24in", quantity: 1, unitCostCents: 2_300 },
      { kind: "material", description: "Expansion tank 2 gal", quantity: 1, unitCostCents: 5_400 },
      { kind: "labor", description: "Labor", quantity: 240, unitCostCents: 0 },
    ],
    "Existing gas line and venting are reusable. Haul-away of the old tank included.",
  );
  await withCard(history, orgId, heater.id);
  await buy(db, orgId, heater.id, "Ferguson Plumbing Supply", await materialsOf(db, heater.id));
  await buy(db, orgId, heater.id, "Ferguson Plumbing Supply", 24_000);
  await explainChangeOrder(history, {
    orgId,
    jobId: heater.id,
    note: "The old flue pipe is corroded through and won't pass inspection. It needs a new flue kit.",
    actor: "crew",
  });
  const raise = await requestRaise(history, { orgId, jobId: heater.id });
  await confirmApproval(history, { token: tokenOf(raise.url), approvedBy: "owner" });
  await buy(db, orgId, heater.id, "Ferguson Plumbing Supply", 24_000);
  const [heaterOrder] = await db.select().from(changeOrders).where(eq(changeOrders.jobId, heater.id));
  await respondToChangeOrder(history, { token: tokenOf(changeOrderUrl(history, heaterOrder.id)), accepted: true });
  await finishWork(history, orgId, heater.id, "Heater's in and the new flue is up. Took about five hours.", 300);
  await sendInvoice(history, { orgId, jobId: heater.id, actor: "owner" });
  await recordPayment(history, { orgId, jobId: heater.id, actor: "owner" });
  await backdate(db, heater.id, 9 * 24);

  const repipe = await quoted(
    history,
    orgId,
    {
      title: "Repipe kitchen supply lines with PEX",
      description: "Galvanized lines under the kitchen are corroded. Replace with PEX and new shut-offs.",
      customer: { name: "Marcus Chen", email: "marcus.chen@example.com", address: "48 Harbor Ave" },
    },
    [
      { kind: "material", description: "PEX tubing 1/2in 100ft", quantity: 2, unitCostCents: 5_050 },
      { kind: "material", description: "Ball valve 3/4in", quantity: 4, unitCostCents: 1_900 },
      { kind: "labor", description: "Labor", quantity: 360, unitCostCents: 0 },
    ],
    "Walls stay closed: access is from the basement ceiling.",
  );
  await withCard(history, orgId, repipe.id);
  await buy(db, orgId, repipe.id, "The Home Depot", await materialsOf(db, repipe.id));
  await finishWork(history, orgId, repipe.id, "Kitchen's repiped. Done in five and a half hours.", 330);
  await sendInvoice(history, { orgId, jobId: repipe.id, actor: "owner" });
  await recordPayment(history, { orgId, jobId: repipe.id, actor: "owner" });
  await backdate(db, repipe.id, 6 * 24 + 3);

  const tank = await quoted(
    history,
    orgId,
    {
      title: "Install expansion tank and new shut-off valves",
      description: "Pressure relief valve keeps dripping. Add an expansion tank and replace two shut-offs.",
      customer: { name: "Priya Patel", email: "priya.patel@example.com", address: "7 Orchard Ln" },
    },
    [
      { kind: "material", description: "Expansion tank 2 gal", quantity: 1, unitCostCents: 5_800 },
      { kind: "material", description: "Ball valve 3/4in", quantity: 2, unitCostCents: 1_800 },
      { kind: "material", description: "Copper pipe 3/4in 10ft", quantity: 1, unitCostCents: 4_950 },
      { kind: "labor", description: "Labor", quantity: 120, unitCostCents: 0 },
    ],
    "Water can be shut off at the street for about an hour.",
  );
  await withCard(history, orgId, tank.id);
  await buy(db, orgId, tank.id, "Ferguson Plumbing Supply", await materialsOf(db, tank.id));
  await finishWork(history, orgId, tank.id, "Tank and valves are in, no more dripping. Two and a half hours.", 150);
  await sendInvoice(history, { orgId, jobId: tank.id, actor: "owner" });
  await recordPayment(history, { orgId, jobId: tank.id, actor: "owner" });
  await backdate(db, tank.id, 4 * 24 + 5);

  /* Open jobs, priced from that history, on real sandbox cards. */

  const electric = await quoted(
    live,
    orgId,
    {
      title: "Replace 40 gal electric water heater",
      description: "No hot water. Element and thermostat both tested bad on a 12-year-old tank.",
      customer: { name: "Tom Alvarez", email: "tom.alvarez@example.com", address: "301 Pine St" },
    },
    await linesFromMemory(
      db,
      orgId,
      [
        { item: "40 gal electric water heater", quantity: 1 },
        { item: "Expansion tank 2 gal", quantity: 1 },
      ],
      180,
    ),
    "Existing 30A circuit is reused.",
  );
  await withCard(live, orgId, electric.id);
  await buy(db, orgId, electric.id, "Ferguson Plumbing Supply", await materialsOf(db, electric.id));
  await finishWork(live, orgId, electric.id, "New heater's running. About three and a half hours.", 210);
  await sendInvoice(live, { orgId, jobId: electric.id, actor: "owner" });
  await backdate(db, electric.id, 3 * 24);

  const shutoff = await quoted(
    live,
    orgId,
    {
      title: "Replace main water shut-off valve",
      description: "Main gate valve won't close fully. Swap it for a ball valve.",
      customer: { name: "Angela Brooks", email: "angela.brooks@example.com", address: "92 Lake Rd" },
    },
    await linesFromMemory(
      db,
      orgId,
      [
        { item: "Ball valve 3/4in", quantity: 1 },
        { item: "Copper pipe 3/4in 10ft", quantity: 1 },
      ],
      150,
    ),
    "The utility shuts water off at the meter.",
  );
  await withCard(live, orgId, shutoff.id);
  await buy(db, orgId, shutoff.id, "The Home Depot", await materialsOf(db, shutoff.id));
  await finishWork(live, orgId, shutoff.id, "New main shut-off is in and holding. Two and three quarter hours.", 165);
  await backdate(db, shutoff.id, 2 * 24);

  const garage = await quoted(
    live,
    orgId,
    {
      title: "Install 50 gal gas water heater in garage",
      description: "Move the water heater from the hall closet to the garage.",
      customer: { name: "Kevin O'Brien", email: "kevin.obrien@example.com", address: "15 Mill St" },
    },
    await linesFromMemory(
      db,
      orgId,
      [
        { item: "50 gal gas water heater", quantity: 1 },
        { item: "Gas flex connector 24in", quantity: 1 },
        { item: "Expansion tank 2 gal", quantity: 1 },
      ],
      300,
    ),
    "The garage has a gas stub within six feet.",
  );
  await withCard(live, orgId, garage.id);
  await buy(db, orgId, garage.id, "Ferguson Plumbing Supply", await materialsOf(db, garage.id));
  // A garage install has to be raised and strapped, which wasn't quoted.
  await buy(db, orgId, garage.id, "Ferguson Plumbing Supply", 18_500);
  await explainChangeOrder(live, {
    orgId,
    jobId: garage.id,
    note: "Code says a garage heater has to sit on an 18 inch stand with seismic straps. Need the stand and the strap kit.",
    actor: "crew",
  });
  await backdate(db, garage.id, 20);

  const copper = await quoted(
    live,
    orgId,
    {
      title: "Replace copper supply lines under two sinks",
      description: "Pinhole leaks in the copper under the kitchen and bathroom sinks.",
      customer: { name: "Sofia Ramirez", email: "sofia.ramirez@example.com", address: "260 Cedar Ave" },
    },
    await linesFromMemory(
      db,
      orgId,
      [
        { item: "Copper pipe 3/4in 10ft", quantity: 3 },
        { item: "Ball valve 3/4in", quantity: 4 },
      ],
      180,
    ),
    "Both sinks are on the same floor.",
  );
  const copperLimit = await withCard(live, orgId, copper.id);
  await buy(db, orgId, copper.id, "The Home Depot", Math.round(copperLimit * 0.62));
  await buy(db, orgId, copper.id, "Ferguson Plumbing Supply", Math.round(copperLimit * 0.25));
  await backdate(db, copper.id, 5);

  /* Jobs still being sold. */

  const sink = await quoted(
    live,
    orgId,
    {
      title: "Install utility sink in garage",
      description: "New utility sink next to the washer, tied into the existing drain.",
      customer: { name: "Ben Foster", email: "ben.foster@example.com", address: "5 Birch Ct" },
    },
    await linesFromMemory(
      db,
      orgId,
      [
        { item: "PEX tubing 1/2in 100ft", quantity: 1 },
        { item: "Ball valve 3/4in", quantity: 2 },
      ],
      180,
      [{ description: "Utility sink with faucet", quantity: 1, unitCostCents: 18_900 }],
    ),
    "The drain tie-in is within ten feet of the washer box.",
  );
  await sendQuoteToCustomer(live, { orgId, jobId: sink.id, expectedVersion: 1, actor: "owner" });
  await backdate(db, sink.id, 26);

  const toilets = await quoted(
    live,
    orgId,
    {
      title: "Replace two toilets",
      description: "Swap two old toilets for new elongated ones in the upstairs bathrooms.",
      customer: { name: "Grace Kim", email: "grace.kim@example.com", address: "88 Valley View" },
    },
    await linesFromMemory(db, orgId, [{ item: "Toilet wax ring", quantity: 2 }], 180, [
      { description: "Elongated toilet, standard height", quantity: 2, unitCostCents: 26_500 },
    ]),
    "Flanges are in good shape. The customer picks the toilet model.",
  );
  await backdate(db, toilets.id, 3);

  // Left as a draft for Claude to quote. Most of what it needs has history
  // above, and the drain pan has none, so the draft shows both cases.
  await createJob(db, {
    orgId,
    title: "Replace water heater at rental unit",
    description:
      "Tenant reports no hot water. The 40 gallon electric tank is leaking at the base and needs replacing. Add an expansion tank, replace the 3/4in shut-off ball valve, and put a drain pan under the new tank.",
    customer: { name: "Luis Moreno", email: "luis.moreno@example.com", address: "44 Grove St, Unit B" },
  });

  return { jobs: 10, realCards: deps.ramp ? 4 : 0 };
}
