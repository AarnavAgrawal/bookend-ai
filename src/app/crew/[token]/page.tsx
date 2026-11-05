import { and, desc, eq, isNull } from "drizzle-orm";
import {
  crewCloseAction,
  crewCostAction,
  crewSimulateAction,
  crewTypedNoteAction,
} from "@/app/actions";
import { CardEmbed } from "@/components/card-embed";
import { ExplainForm, PhotoUpload, SubmitButton, VoiceRecorder } from "@/components/capture";
import { ErrorNote, money, NotFoundNote, PublicShell, Rail, Section } from "@/components/ui";
import { changeOrders, manualCosts, rampConnections, receipts, voiceNotes } from "@/db/schema";
import type { VoiceExtraction } from "@/ai/extract";
import { getDeps } from "@/platform/deps";
import { jobFromCrewLink, jobSpend } from "@/services/field";
import { loadOrg } from "@/services/jobs";

export default async function CrewPage(props: PageProps<"/crew/[token]">) {
  const deps = await getDeps();
  const { db } = deps;
  const { token } = await props.params;
  const { error } = await props.searchParams;

  const job = await jobFromCrewLink(deps, token);
  if (!job) {
    return (
      <NotFoundNote
        title="This job is closed"
        detail="If you still need it, ask the owner for a new link."
      />
    );
  }
  const org = await loadOrg(db, job.orgId);
  const { fund, spend, transactions } = await jobSpend(db, job.id);
  const [connection] = await db
    .select({ mode: rampConnections.mode })
    .from(rampConnections)
    .where(eq(rampConnections.orgId, job.orgId));
  const [order] = await db
    .select()
    .from(changeOrders)
    .where(and(eq(changeOrders.jobId, job.id), eq(changeOrders.ownerStatus, "pending")));
  const jobReceipts = await db.select().from(receipts).where(eq(receipts.jobId, job.id));
  const costs = await db.select().from(manualCosts).where(eq(manualCosts.jobId, job.id));
  const [note] = await db
    .select()
    .from(voiceNotes)
    .where(and(eq(voiceNotes.jobId, job.id), isNull(voiceNotes.confirmedAt)))
    .orderBy(desc(voiceNotes.createdAt))
    .limit(1);

  const uploadUrl = `/api/crew/${token}/upload`;
  const declined = job.state === "change_pending";
  const extraction = note?.extraction as VoiceExtraction | null;
  const hours = extraction?.hours_worked ?? "";

  return (
    <PublicShell orgName={org.name}>
      <ErrorNote message={error} />
      <h1 className="text-3xl">{job.title}</h1>

      {fund && (
        <div className="mt-5">
          <p className="money text-5xl">{money(spend.remainingCents)}</p>
          <p className="mb-2 text-muted">left on the card, of {money(fund.limitCents)}</p>
          <Rail committedCents={spend.committedCents} limitCents={fund.limitCents} height="h-7" />
        </div>
      )}

      {declined && order && (
        <div className="ticket ticket-alert mt-6">
          <h2 className="text-2xl">Declined: {money(order.declinedCents)} over budget</h2>
          {order.reason ? (
            <p className="mt-2">
              The owner has your note: {order.reason} Retry the purchase once they raise the limit.
            </p>
          ) : (
            <div className="mt-3">
              <ExplainForm uploadUrl={uploadUrl} />
            </div>
          )}
        </div>
      )}

      {job.state !== "closing" && (
        <Section title="Pay with the job card">
          {fund?.state === "active" ? (
            <CardEmbed embedUrl={`/api/crew/${token}/embed`} />
          ) : (
            <p className="text-muted">The card is frozen.</p>
          )}
        </Section>
      )}

      {connection && connection.mode !== "production" && fund?.state === "active" && (
        <Section title="Test purchase">
          <p className="mb-3 text-sm text-muted">
            Sandbox only. Stands in for a card swipe and enforces the limit. No money moves.
          </p>
          <form action={crewSimulateAction.bind(null, token)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label>
                Store
                <input name="merchant" defaultValue="Ferguson" />
              </label>
              <label>
                Amount ($)
                <input name="amount" type="number" step="0.01" min="0.01" required />
              </label>
            </div>
            <SubmitButton className="btn btn-quiet w-full">Simulate a card swipe</SubmitButton>
          </form>
        </Section>
      )}

      <Section title="Receipts">
        <PhotoUpload uploadUrl={uploadUrl} label="Photograph a receipt" />
        {jobReceipts.length > 0 && (
          <ul className="mt-3 text-sm">
            {jobReceipts.map((r) => (
              <li key={r.id} className="flex justify-between border-b border-line py-1.5">
                <span>{r.merchantName ?? "Saved, waiting to be read"}</span>
                {r.totalCents !== null && <span className="money">{money(r.totalCents)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {transactions.length > 0 && (
        <Section title="Card activity">
          <ul className="text-sm">
            {transactions.map((t) => (
              <li key={t.id} className="flex justify-between border-b border-line py-1.5">
                <span>
                  {t.merchantName ?? "Unknown"}
                  {t.state === "DECLINED" && <span className="text-redtext"> declined</span>}
                </span>
                <span className="money">{money(t.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Paid another way">
        <form action={crewCostAction.bind(null, token)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label>
              What for
              <input name="description" required placeholder="Van stock" />
            </label>
            <label>
              Amount ($)
              <input name="amount" type="number" step="0.01" min="0.01" required />
            </label>
          </div>
          <SubmitButton className="btn btn-quiet w-full">Add this cost</SubmitButton>
        </form>
        {costs.length > 0 && (
          <ul className="mt-3 text-sm">
            {costs.map((c) => (
              <li key={c.id} className="flex justify-between border-b border-line py-1.5">
                <span>{c.description}</span>
                <span className="money">{money(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {job.state === "active" && (
        <Section title="Finish the job">
          {note ? (
            <form action={crewCloseAction.bind(null, token, note.id)} className="space-y-3">
              <p className="text-muted">
                Check this before you finish. Finishing freezes the card and drafts the invoice.
              </p>
              <label>
                Your note
                <textarea name="transcript" rows={4} required defaultValue={note.transcript ?? ""} />
              </label>
              <label>
                Hours worked
                <input name="hours" type="number" step="0.25" min="0" required defaultValue={hours} />
              </label>
              {extraction?.open_issues && (
                <p className="text-sm text-muted">Open issue noted: {extraction.open_issues}</p>
              )}
              <SubmitButton className="btn btn-amber w-full" pending="Freezing the card…">
                Finish and freeze the card
              </SubmitButton>
            </form>
          ) : (
            <div className="space-y-3">
              {deps.transcriber && <VoiceRecorder uploadUrl={uploadUrl} />}
              <form action={crewTypedNoteAction.bind(null, token)} className="space-y-3">
                <label>
                  {deps.transcriber ? "Or type it" : "What did you do?"}
                  <textarea name="note" rows={3} />
                </label>
                <SubmitButton className="btn btn-quiet w-full">Save my note</SubmitButton>
              </form>
            </div>
          )}
        </Section>
      )}
    </PublicShell>
  );
}
