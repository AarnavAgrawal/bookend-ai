import { respondChangeOrderAction } from "@/app/actions";
import { SubmitButton } from "@/components/capture";
import { ErrorNote, money, NotFoundNote, PublicShell } from "@/components/ui";
import { getDeps } from "@/platform/deps";
import { changeOrderFromLink } from "@/services/jobs";

export default async function ChangeOrderPage(props: PageProps<"/c/[token]">) {
  const deps = await getDeps();
  const { token } = await props.params;
  const { error } = await props.searchParams;

  const found = await changeOrderFromLink(deps, token);
  if (!found) {
    return <NotFoundNote title="This link isn't valid" detail="Ask for a new link." />;
  }
  const { order, job, org } = found;

  return (
    <PublicShell orgName={org.name}>
      <ErrorNote message={error} />
      <div className="ticket">
        <p className="text-muted">{job.title}</p>
        <h1 className="mt-1 text-4xl">
          Extra cost: <span className="money">{money(order.sellAmountCents ?? 0)}</span>
        </h1>
        <p className="mt-3">{order.reason ?? "This job needs more materials than quoted."}</p>
      </div>
      {order.customerStatus === "pending" ? (
        <div className="mt-6 space-y-3">
          <form action={respondChangeOrderAction.bind(null, token, true)}>
            <SubmitButton className="btn btn-amber w-full">Accept this change</SubmitButton>
          </form>
          <form action={respondChangeOrderAction.bind(null, token, false)}>
            <SubmitButton className="btn btn-quiet w-full">Decline this change</SubmitButton>
          </form>
        </div>
      ) : (
        <p className="mt-6 font-display text-2xl font-semibold">
          {order.customerStatus === "accepted" ? "Accepted. Thank you." : "Declined."}
        </p>
      )}
    </PublicShell>
  );
}
