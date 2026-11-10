import Link from "next/link";
import { confirmApprovalAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote, money, NotFoundNote, PublicShell, Rail } from "@/components/ui";
import { getDeps } from "@/platform/deps";
import { jobSpend } from "@/services/field";
import { describeApproval, loadOrg } from "@/services/jobs";

/**
 * Opening this page changes nothing: email scanners fetch links on their own.
 * Only the button's POST spends the approval.
 */
export default async function ApprovePage(props: PageProps<"/approve/[token]">) {
  const { db } = await getDeps();
  const { token } = await props.params;
  const { error, done } = await props.searchParams;

  const found = await describeApproval(db, token);
  if (!found) {
    return (
      <NotFoundNote title="This approval link isn't valid" detail="Open the job to request a new one." />
    );
  }
  const { approval, job } = found;
  const org = await loadOrg(db, approval.orgId);
  const { fund, spend } = await jobSpend(db, job.id);
  const isRaise = approval.kind === "limit_raise";
  const expired = approval.expiresAt <= new Date();
  // Once the link is used or out of date, the live figures no longer describe this request.
  const pending = !done && !approval.consumedAt && !expired;

  return (
    <PublicShell orgName={org.name}>
      <ErrorNote message={error} />
      <div className="ticket">
        <p className="text-muted">{job.title}</p>
        <h1 className="mt-1 text-4xl">
          {pending
            ? isRaise
              ? "Raise the limit to"
              : "Open a card limited to"
            : isRaise
              ? "Limit raise to"
              : "Card limited to"}{" "}
          <span className="money">{money(approval.amountCents)}</span>
        </h1>
        {pending && isRaise && fund && (
          <div className="mt-4">
            <Rail committedCents={spend.committedCents} limitCents={fund.limitCents} />
            <p className="mt-1 text-sm text-muted">
              {money(spend.committedCents)} spent of the current {money(fund.limitCents)} limit
            </p>
          </div>
        )}
        {pending && (
          <p className="mt-4 text-muted">
            {isRaise
              ? "The crew can retry their purchase as soon as you confirm."
              : "The card can't spend more than this, and it's frozen when the job closes."}
          </p>
        )}
      </div>

      {done && (
        <div className="mt-6">
          <p className="font-display text-2xl font-semibold">
            {done === "succeeded" ? "Done." : "Sent to Ramp. It's finishing in the background."}
          </p>
          <Link href={`/jobs/${job.id}`} className="underline">
            Back to the job
          </Link>
        </div>
      )}

      {pending && (
        <form action={confirmApprovalAction.bind(null, token)} className="mt-6">
          <SubmitButton className="btn btn-amber w-full" pending="Talking to Ramp…">
            {isRaise ? "Confirm the raise" : "Confirm and open the card"}
          </SubmitButton>
        </form>
      )}
      {!done && (approval.consumedAt || expired) && (
        <p className="mt-6 text-muted">
          {expired ? "This link has expired." : "This approval has already been used."}{" "}
          <Link href={`/jobs/${job.id}`} className="underline">
            Open the job
          </Link>
        </p>
      )}
    </PublicShell>
  );
}
